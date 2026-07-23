import { useState } from "react";
import type { Identifier } from "ra-core";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CrmDataProvider } from "../providers/types";
import type {
  MergeResolution,
  Reference,
  ReferenceMergePreview,
} from "../types";
import { CollisionResolver } from "./ReferenceMergeCollision";

/**
 * Merging two duplicate references (§4), forked from ContactMergeButton.
 *
 * Where it deliberately diverges: references are linked many-to-many to
 * shidduchim, so two duplicates can each hold a call log for the SAME single.
 * Contacts have no equivalent of that, so the contacts merge has no answer for
 * it. Here the merge is blocked until the user says what should happen to each
 * collision, and no side's what_they_said is ever discarded — the losing entry
 * is preserved on the timeline.
 *
 * PRODUCT NOTE: there is no FR id for post-hoc reference merge. It is implied by
 * "reusable, cross-shidduch" (FR39/FR42) and was built to explicit requirement;
 * an FR should be minted for it rather than treated as pre-existing.
 */

const displayName = (reference?: Reference | null): string =>
  reference?.name_en || "this person";

export const ReferenceMergeButton = () => {
  const record = useRecordContext<Reference>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();

  const [isOpen, setIsOpen] = useState(false);
  const [loserId, setLoserId] = useState<Identifier | null>(null);
  const [preview, setPreview] = useState<ReferenceMergePreview | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, MergeResolution>
  >({});
  const [isWorking, setIsWorking] = useState(false);

  // Likely duplicates: same phone, or the same name. This is a convenience
  // shortlist for the picker, NOT a matching decision — the merge itself is
  // always an explicit choice.
  const { data: possibleDuplicates } = useGetList<Reference>(
    "references",
    {
      filter: record?.phone
        ? { "phone@eq": record.phone }
        : { "name_en@eq": record?.name_en },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "name_en", order: "ASC" },
    },
    { enabled: Boolean(record?.id && (record.phone || record.name_en)) },
  );

  const candidates = (possibleDuplicates ?? []).filter(
    (candidate) => candidate.id !== record?.id,
  );

  const openWith = async (id: Identifier) => {
    setLoserId(id);
    setResolutions({});
    setIsWorking(true);
    try {
      const result = await dataProvider.previewReferenceMerge(id, record!.id);
      setPreview(result);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to prepare the merge",
        { type: "error" },
      );
      setPreview(null);
    } finally {
      setIsWorking(false);
    }
  };

  const unresolved = (preview?.collisions ?? []).filter(
    (collision) => !resolutions[String(collision.shidduchim_id)],
  );

  const handleMerge = async () => {
    if (!record || loserId == null || unresolved.length > 0) return;
    setIsWorking(true);
    try {
      await dataProvider.mergeReferences(loserId, record.id, resolutions);
      notify("crm.references.merge.done", {
        type: "success",
        messageArgs: { _: "The two records are now one." },
      });
      setIsOpen(false);
      redirect("show", "references", record.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to merge", {
        type: "error",
      });
    } finally {
      setIsWorking(false);
    }
  };

  if (!record) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px]"
        onClick={() => setIsOpen(true)}
      >
        {translate("crm.references.merge.action", { _: "Merge duplicates" })}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {translate("crm.references.merge.title", {
                _: "Merge into this person",
              })}
            </DialogTitle>
            <DialogDescription>
              {translate("crm.references.merge.description", {
                name: displayName(record),
                _: "Everything from the duplicate moves onto %{name}. This cannot be undone.",
              })}
            </DialogDescription>
          </DialogHeader>

          {loserId == null ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                {translate("crm.references.merge.pick", {
                  _: "Which record is the duplicate?",
                })}
              </p>
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {translate("crm.references.merge.noCandidates", {
                    _: "No likely duplicates found for this person.",
                  })}
                </p>
              ) : (
                candidates.map((candidate) => (
                  <Button
                    key={String(candidate.id)}
                    type="button"
                    variant="outline"
                    className="min-h-[44px] justify-start"
                    onClick={() => openWith(candidate.id)}
                  >
                    <span className="truncate">
                      {displayName(candidate)}
                      {candidate.phone ? ` · ${candidate.phone}` : ""}
                      {candidate.relationship
                        ? ` · ${candidate.relationship}`
                        : ""}
                    </span>
                  </Button>
                ))
              )}
            </div>
          ) : null}

          {preview ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium">
                    {translate("crm.references.merge.keeping", {
                      _: "Keeping",
                    })}
                  </p>
                  <p>{displayName(preview.winner)}</p>
                  <p className="text-muted-foreground">
                    {preview.winner.phone} {preview.winner.relationship}
                  </p>
                </div>
                <div>
                  <p className="font-medium">
                    {translate("crm.references.merge.removing", {
                      _: "Removing",
                    })}
                  </p>
                  <p>{displayName(preview.loser)}</p>
                  <p className="text-muted-foreground">
                    {preview.loser.phone} {preview.loser.relationship}
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {translate("crm.references.merge.moving", {
                  links: preview.reference_links_count,
                  interactions: preview.interactions_count,
                  tasks: preview.open_tasks_count,
                  _: "%{links} linked singles, %{interactions} timeline entries and %{tasks} open reminders will move across.",
                })}
              </p>

              {preview.collisions.length > 0 ? (
                <CollisionResolver
                  collisions={preview.collisions}
                  resolutions={resolutions}
                  onChange={(shidduchimId, resolution) =>
                    setResolutions((current) => ({
                      ...current,
                      [String(shidduchimId)]: resolution,
                    }))
                  }
                />
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsOpen(false);
                setLoserId(null);
                setPreview(null);
              }}
            >
              {translate("ra.action.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isWorking || preview == null || unresolved.length > 0}
              onClick={handleMerge}
            >
              {unresolved.length > 0
                ? translate("crm.references.merge.resolveFirst", {
                    smart_count: unresolved.length,
                    _: "Resolve %{smart_count} conflicts first",
                  })
                : translate("crm.references.merge.confirm", {
                    _: "Merge, this cannot be undone",
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

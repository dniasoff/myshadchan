import { useState } from "react";
import type { Identifier } from "ra-core";
import {
  useCreate,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  Interaction,
  InteractionKind,
  ReferenceLinkSummary,
} from "../types";

/**
 * The reference timeline and notes (§5b).
 *
 * Notes and the timeline are one surface, not two: a note is simply an
 * interaction with kind "note", and the timeline is the same table ordered by
 * date. That is why this component covers both — building a parallel notes table
 * for references would have forked FR36's established pattern for no gain.
 */

const KIND_LABELS: Record<InteractionKind, { key: string; fallback: string }> =
  {
    note: { key: "crm.references.timeline.kind.note", fallback: "Note" },
    call_logged: {
      key: "crm.references.timeline.kind.call_logged",
      fallback: "Call logged",
    },
    status_change: {
      key: "crm.references.timeline.kind.status_change",
      fallback: "Status changed",
    },
    merge: { key: "crm.references.timeline.kind.merge", fallback: "Merged" },
    link_created: {
      key: "crm.references.timeline.kind.link_created",
      fallback: "Linked to a single",
    },
    link_removed: {
      key: "crm.references.timeline.kind.link_removed",
      fallback: "Unlinked from a single",
    },
  };

const GENERAL_NOTE = "general";

/**
 * Adding a note forces a choice the data model needs anyway: is this about the
 * person in general, or about one specific single you asked them about?
 *
 * That is not busywork. A note tied to a shidduch inherits that shidduch's
 * visibility (AD-3); a general note has no shidduch parent and so can never be
 * child-visible. The database refuses a row that answers neither, so the choice
 * is made here rather than guessed later.
 */
const AddNote = ({
  referenceId,
  links,
}: {
  referenceId: Identifier;
  links: ReferenceLinkSummary[];
}) => {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [body, setBody] = useState("");
  const [about, setAbout] = useState<string>(GENERAL_NOTE);

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "") return;

    const isGeneral = about === GENERAL_NOTE;

    try {
      await create(
        "interactions",
        {
          data: {
            target_type: "reference",
            target_id: referenceId,
            kind: "note",
            body: text,
            scope: isGeneral ? "account" : "shidduch",
            reference_link_id: isGeneral ? null : Number(about),
          },
        },
        { returnPromise: true },
      );
      setBody("");
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add the note",
        {
          type: "error",
        },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder={translate("crm.references.timeline.notePlaceholder", {
          _: "Add a note about this person",
        })}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="note-about" className="text-sm text-muted-foreground">
          {translate("crm.references.timeline.noteAbout", {
            _: "This note is",
          })}
        </label>
        <select
          id="note-about"
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          className="min-h-[44px] rounded-md border bg-background px-3 text-sm"
        >
          <option value={GENERAL_NOTE}>
            {translate("crm.references.timeline.noteGeneral", {
              _: "About this person generally",
            })}
          </option>
          {links
            .filter((link) => link.shidduchim_id != null)
            .map((link) => (
              <option key={String(link.id)} value={String(link.id)}>
                {translate("crm.references.timeline.noteAboutShidduch", {
                  name: link.shidduch_name_en || link.shidduch_name_he || "",
                  _: "About %{name}",
                })}
              </option>
            ))}
        </select>
        <Button
          type="button"
          className="min-h-[44px]"
          disabled={isPending || body.trim() === ""}
          onClick={handleAdd}
        >
          {translate("crm.references.timeline.addNote", { _: "Add note" })}
        </Button>
      </div>
    </div>
  );
};

export const ReferenceTimeline = ({
  referenceId,
  links,
}: {
  referenceId: Identifier;
  links: ReferenceLinkSummary[];
}) => {
  const translate = useTranslate();
  const { data, isPending } = useGetList<Interaction>("interactions", {
    filter: { target_type: "reference", target_id: referenceId },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "created_at", order: "DESC" },
  });

  const interactions = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <AddNote referenceId={referenceId} links={links} />

      {isPending ? (
        <p className="text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : interactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("crm.references.timeline.empty", {
            _: "Nothing has happened with this person yet.",
          })}
        </p>
      ) : (
        <ul className="flex flex-col gap-3 border-s ps-4">
          {interactions.map((interaction) => {
            const label = KIND_LABELS[interaction.kind] ?? KIND_LABELS.note;
            return (
              <li key={String(interaction.id)} className="relative">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {translate(label.key, { _: label.fallback })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(interaction.created_at).toLocaleString()}
                  </span>
                </div>
                {interaction.body ? (
                  <p className="whitespace-pre-line text-sm">
                    {interaction.body}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

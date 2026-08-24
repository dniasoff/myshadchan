import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import { EntityAvatar } from "../entity360/EntityAvatar";
import { RecordLink } from "../entity360/RecordLink";
import type { ReferenceSummary } from "../types";
import { ReferenceAttachToShidduch } from "./ReferenceAttachToShidduch";

/**
 * What `#/references` resolves to under RULING 7 — the unattached-references
 * index, NOT a reference book.
 *
 * The ruling: "references only exist as part of an individual shidduch and
 * cannot be browsed separately". So the reference book is gone: no free-text
 * search, no relationship or count filters, no Create button, no sort, no
 * pagination, and no query that can return a reference a user has not
 * already reached through a shidduch — with exactly one exception, which is
 * this file.
 *
 * The exception is not a loophole, it is the ruling's own premise turned
 * around. A reference with zero `reference_links` has no shidduch context to
 * be reached FROM. Nothing links to it, `RecordLink` never renders it, and
 * the shidduch tab it should have appeared in does not know it exists — yet
 * it is counted in `settings/PrivacySection` and included in the GDPR export.
 * Leaving it unreachable is not scoping, it is a leak of a different kind.
 * So this surface exists to make that class visible, attachable, and
 * therefore empty.
 *
 * It is self-emptying by construction: `ReferenceCreate` refuses an unscoped
 * create and links every save to the shidduch it came from, so no new orphan
 * can be produced. Once each existing one is attached, this page renders the
 * "references are reached from a shidduch" explainer permanently.
 *
 * Why `list:` in `references/index.ts` still points here rather than being
 * dropped: in this codebase `list` is the ROUTE MOUNT, not "the list page".
 * `entity360/buildEntityRoutes.tsx` types `List` as required and the element
 * passed to `<Resource list={…}>` is what mounts `/references/:id`. Dropping
 * the prop would delete the record route along with the book.
 */

/** The whole rule, in one place: only references attached to nothing. */
const UNATTACHED_ONLY = { "linked_shidduchim_count@eq": 0 } as const;

/** Bounded on purpose. This set is meant to trend to zero; a page-2 control
 * would be a browse affordance for a surface that must not have one. */
const MAX_SHOWN = 50;

const ReferencesIndexHeader = () => {
  const translate = useTranslate();

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {translate("crm.references.index.eyebrow", { _: "Needs a shidduch" })}
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {translate("crm.references.index.title", {
          _: "Unattached references",
        })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate("crm.references.index.subtitle", {
          _: "People recorded without a shidduch. Attach each one to the shidduch you spoke to them about, and they will be reached from there instead.",
        })}
      </p>
    </div>
  );
};

const ReferencesIndexEmpty = () => {
  const translate = useTranslate();

  return (
    <div className="rounded-2xl border border-dashed p-10 text-sm text-muted-foreground">
      <p>
        {translate("crm.references.index.empty", {
          _: "Every reference belongs to a shidduch. References are reached from the shidduch they were asked about, not browsed on their own.",
        })}
      </p>
      <Link
        to="/shidduchim"
        className="mt-2 inline-block font-medium text-foreground underline underline-offset-4"
      >
        {translate("crm.references.index.emptyLink", {
          _: "Go to the pipeline",
        })}
      </Link>
    </div>
  );
};

export const ReferencesIndex = () => {
  const { data, isPending } = useGetList<ReferenceSummary>("references", {
    filter: UNATTACHED_ONLY,
    pagination: { page: 1, perPage: MAX_SHOWN },
    sort: { field: "name_en", order: "ASC" },
  });

  if (isPending) {
    return (
      <div>
        <ReferencesIndexHeader />
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-2xl bg-muted"
            />
          ))}
        </div>
      </div>
    );
  }

  const references = data ?? [];

  return (
    <div>
      <ReferencesIndexHeader />
      {references.length === 0 ? (
        <ReferencesIndexEmpty />
      ) : (
        <div className="flex flex-col gap-3">
          {references.map((reference) => (
            <Card
              key={String(reference.id)}
              className="flex flex-row flex-wrap items-center gap-4 rounded-2xl p-4 shadow-sm"
            >
              <EntityAvatar
                seed={reference.name_en ?? String(reference.id)}
                monogramSource={reference.name_en}
                className="h-11 w-11 shrink-0 rounded-xl text-sm"
              />

              <div className="min-w-0 flex-1">
                <RecordLink
                  resource="references"
                  id={reference.id}
                  className="text-sm font-semibold leading-tight hover:underline"
                >
                  {reference.name_en || "?"}
                </RecordLink>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {[reference.relationship, reference.phone, reference.school]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <ReferenceAttachToShidduch
                referenceId={reference.id}
                referenceName={reference.name_en}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

import type { ReactElement } from "react";
import {
  useGetList,
  useGetRecordRepresentation,
  useRecordContext,
  useTranslate,
} from "ra-core";
import type { RaRecord } from "ra-core";

import { Skeleton } from "@/components/ui/skeleton";

import { RecordLink } from "../RecordLink";
import type { EntityRelationshipDescriptor } from "../relationshipDescriptor";

const DEFAULT_PER_PAGE = 25;

export interface RelatedRecordsTabProps {
  relationship: EntityRelationshipDescriptor;
}

/**
 * Story 3-10 (tab vocabulary) AC 7 / Epic 3 API contract §9's one
 * implementation of "a list of rows from another resource, filtered by the
 * subject record" — every `relationships` entry on an `EntityDescriptor`
 * renders through this component, so `5-8`, `5-10` and `8-5` reuse it
 * instead of each hand-rolling the same related-records list.
 *
 * **Ownership note.** This module belongs to Story 3-10 Task 6 (part
 * 3.10b), gated there on Story 3.9 (`RecordLink`) and Story 3.3a
 * (`EntityDescriptor`/registry) landing first. Both landed before Story
 * 3.3b (`EntityShow`, whose AC 10 is the only caller of this component) was
 * picked up, and 3-10's own Task 6 was still unchecked — an unowned gap the
 * 3-10 story text itself flags rather than silently absorbs (see this
 * story's Dev Notes "Contract deviation"). Built here, inside the 3.3b
 * session, because `EntityShow`'s AC 10 cannot compile — let alone be
 * tested — without it; 3-10's story file is updated in the same commit to
 * record Task 6 as done and point back here.
 *
 * Queries `relationship.resource` (which MAY be a summary/join view) with
 * `relationship.getFilter(record)`, then renders each row through
 * `RecordLink`, targeting `linkResource`/`linkId` when the queried row is a
 * link/summary row rather than the target record itself (the
 * reference → shidduchim many-to-many, via `reference_links_summary`).
 * Pending / error / empty are this component's own states (UX-DR11) — the
 * caller (`EntityShow`) never sees them.
 */
export function RelatedRecordsTab({
  relationship,
}: RelatedRecordsTabProps): ReactElement {
  const record = useRecordContext();
  const translate = useTranslate();
  const linkResource = relationship.linkResource ?? relationship.resource;
  const getRecordRepresentation = useGetRecordRepresentation(linkResource);

  const { data, error, isPending } = useGetList<RaRecord>(
    relationship.resource,
    {
      filter: record ? relationship.getFilter(record) : {},
      sort: relationship.sort,
      pagination: {
        page: 1,
        perPage: relationship.perPage ?? DEFAULT_PER_PAGE,
      },
    },
    { enabled: record != null },
  );

  if (isPending) {
    const loadingLabel = translate("crm.entity360.related.loading", {
      _: "Loading…",
    });
    return (
      <div
        role="status"
        aria-label={loadingLabel}
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {translate("crm.entity360.related.error", {
          _: "Could not load related records.",
        })}
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {relationship.emptyLabel ??
          translate("crm.entity360.related.empty", {
            _: "Nothing here yet.",
          })}
      </p>
    );
  }

  return (
    /*
     * Tailwind's preflight strips the browser's default anchor colour and
     * underline, and `src/index.css` restores only `cursor: pointer` — so a
     * `RecordLink` with no `className` renders as plain text. These rows are
     * the ONLY way to get from this record to a related one, and they looked
     * like static labels. The affordance below is the one the sibling call
     * sites already use (`ActivityTab.tsx`, `TasksRailSummary.tsx`), plus the
     * row height a thumb needs: `gap-2` between two 20px lines of text made
     * every row a 20px target 8px from the next one.
     */
    <ul className="flex flex-col gap-1">
      {data.map((row) => {
        const id = relationship.linkId?.(row) ?? row.id;
        return (
          <li key={String(id)}>
            <RecordLink
              resource={linkResource}
              id={id}
              className="flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 md:min-h-9"
            >
              {relationship.linkLabel?.(row) ?? getRecordRepresentation(row)}
            </RecordLink>
          </li>
        );
      })}
    </ul>
  );
}

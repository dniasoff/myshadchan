import type { ReactElement, ReactNode } from "react";
import type { Identifier } from "ra-core";
import { ListBase, useListContext, useTranslate } from "ra-core";

import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/admin/list-pagination";

import type { Interaction } from "../../types";
import { RecordLink } from "../RecordLink";
import {
  formatTimelineDate,
  INTERACTION_KIND_LABELS,
} from "./interactionLabels";
import type { UniversalTabProps } from "./types";

/** AC 12 — loading placeholder, `ShidduchShow.tsx`'s skeleton idiom. */
function ActivitySkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

/**
 * AC 12 — a plain inline translated empty message, `ShidduchTimeline.tsx`'s
 * idiom. Deliberately NOT `misc/EmptyState.tsx`'s CTA treatment, which is
 * for whole-page emptiness, not one tab.
 */
function ActivityEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.activity.empty", {
        _: "Nothing logged yet.",
      })}
    </p>
  );
}

/** AC 12 — a translated fetch-error message; never a blank tab. */
function ActivityError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.activity.error", {
        _: "Could not load the activity feed.",
      })}
    </p>
  );
}

function isValidRecordId(value: unknown): value is Identifier {
  return typeof value === "string" || typeof value === "number";
}

/**
 * AC 9's mention branch. `metadata` is free-form client-writable `jsonb`
 * (`06_grants.sql` grants `update (body, metadata)`), so this is a runtime
 * guard, not a cast: a malformed value degrades to "no mention" rather than
 * a crash, and `RecordLink` itself degrades an unregistered resource to
 * plain text (contract §7 rule 2). Exactly two recognised shapes, checked in
 * that order, and at most one mention renders per row — a row never renders
 * a list. Everything else (including `{ merged_from_reference_id }`, whose
 * referent `merge_references()` deletes two statements after writing it)
 * renders no mention at all.
 */
function ActivityMention({
  metadata,
}: {
  metadata: Interaction["metadata"];
}): ReactNode {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;

  if (
    typeof record.linkedResource === "string" &&
    isValidRecordId(record.linkedId)
  ) {
    return (
      <RecordLinkMention
        resource={record.linkedResource}
        id={record.linkedId}
      />
    );
  }

  if (isValidRecordId(record.shidduchim_id)) {
    return (
      <RecordLinkMention resource="shidduchim" id={record.shidduchim_id} />
    );
  }

  return null;
}

function RecordLinkMention({
  resource,
  id,
}: {
  resource: string;
  id: Identifier;
}): ReactElement {
  const translate = useTranslate();
  return (
    <RecordLink resource={resource} id={id} className="text-sm underline">
      {translate("crm.entity360.activity.viewRecord", { _: "View record" })}
    </RecordLink>
  );
}

/** Reads the active page's rows off `ListContext` — supplied by `ListBase`. */
function ActivityFeed(): ReactElement {
  const { data } = useListContext<Interaction>();
  const translate = useTranslate();
  const interactions = data ?? [];

  return (
    <ul className="flex flex-col gap-3 border-s border-border ps-4">
      {interactions.map((interaction) => {
        const label = INTERACTION_KIND_LABELS[interaction.kind];
        return (
          <li key={String(interaction.id)}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium">
                {translate(label.key, { _: label.fallback })}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatTimelineDate(interaction.created_at)}
              </span>
            </div>
            {interaction.body ? (
              <p className="whitespace-pre-line text-sm">{interaction.body}</p>
            ) : null}
            <ActivityMention metadata={interaction.metadata} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The first universal tab (Story 3.5, contract §8): a read-only,
 * newest-first, paginated feed of `interactions` for any of the four
 * `EntityTargetType`s. Takes exactly `UniversalTabProps` — no extra props,
 * no per-entity variants.
 *
 * Built on `ListBase`, not a bare `useGetList`: there is no
 * `ListPaginationContextProvider` in `ra-core` — only the raw
 * `ListPaginationContext`, and `useListPaginationContext` throws when the
 * context is absent — so `<ListPagination>` needs the real
 * `ListContextProvider` `ListBase` supplies. `disableSyncWithLocation` keeps
 * the tab's own paging out of the URL (the URL belongs to the 360's route
 * shape, UX-DR2) and defaults `storeKey` to `false`, so two 360s opened in
 * sequence do not share a page number.
 */
export function ActivityTab({
  targetType,
  targetId,
}: UniversalTabProps): ReactElement {
  return (
    <ListBase<Interaction>
      resource="interactions"
      disableSyncWithLocation
      filter={{
        target_type: targetType,
        target_id: targetId,
        "deleted_at@is": null,
      }}
      sort={{ field: "created_at", order: "DESC" }}
      perPage={20}
      loading={<ActivitySkeleton />}
      empty={<ActivityEmpty />}
      error={<ActivityError />}
    >
      <ActivityFeed />
      <ListPagination rowsPerPageOptions={[20, 50]} />
    </ListBase>
  );
}

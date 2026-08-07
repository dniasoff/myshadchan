import { useMemo } from "react";
import type { Identifier } from "ra-core";
import { useGetList, useGetMany } from "ra-core";

import { targetEntityLabel } from "../reminders/reminderEntity";
import { isOverdue } from "../tasks/tasksPredicate";
import type { ReferenceLinkSummary, Task, TaskTargetType } from "../types";

/**
 * The dashboard's read-only "Due now" card (Story 12.1, gap D1). This hook
 * is deliberately a SEPARATE module from the reminders hub's own data hook
 * (`reminders/` — never imported here): that hub hook performs task
 * mutations (mark-done, snooze), which would put a mutation inside a
 * read-only card's module graph and make `DueRemindersCard.guard.test.ts`'s
 * AC-3 scan vacuous (F7). This file shares only the hub's PURE helpers:
 * `isOverdue`, `targetEntityLabel`, and (in `DueRemindersCard.tsx`)
 * `formatDueMoment`.
 *
 * `dashboard/**` is a declared browse-surface module
 * (`entity360/ad24Conformance.ts`'s `BROWSE_SURFACE_MODULE_PATTERNS`), and
 * `references`/`references_summary` are the one no-browse entity that rule
 * polices. This file therefore never issues a list query — or, per the
 * discipline `ad24Conformance.ts:692-694` names (the guard does not match
 * `useGetOne`/`useGetMany`), never even an id-scoped read — against
 * `references`. A reference-targeted task is resolved entirely through
 * `reference_links` (`reference_id@in`), which already carries the joined
 * `reference_name_en` / `shidduchim_id` / `shidduch_name_en` (AD-10,
 * `03_views.sql`'s `reference_links_summary`).
 */

export const MAX_ROWS = 3;

/** The four target types this card resolves to a real record + name via a
 * plain `useGetMany` on their own resource. `reference` is handled on its
 * own path (Query three below); it is not a "label" type because it never
 * reads `references` (AD-24 RULING 7 — see the module doc comment).
 *
 * F17 (Epic 12 adversarial review): `connection` joined this set. It is a
 * registered, routable resource (`root/routeManifest.ts`'s `RESOURCES` —
 * `hasShow: true`, `buildEntityRoutes`), so per this story's own "resolve it
 * like the other browsable types when it is routable" instruction it is
 * resolved exactly like `shidduch`/`shadchan`/`single`, not left as inert
 * text. `reminderEntity.ts`'s `targetEntityLabel` already has a `"connection"`
 * branch (`record.household_account_name`), so no new label logic is needed
 * here — only the resource mapping and the `useGetMany` call below.
 *
 * Known, pre-existing, out-of-scope limitation carried over unchanged: the
 * `connections` resource is `contextKind: "shadchanus"`-gated
 * (`routeManifest.ts`), so a household-context viewer following this link
 * hits `RequireContextKind`'s silent redirect to `/`. The already-shipped
 * reminders hub (`reminders/ReminderCard.tsx` + `entity360/RecordLink.tsx`)
 * has the exact same behavior for a household-context connection task today
 * — this card is being made consistent with that existing pattern, not
 * introducing a new gap. Fixing the redirect itself is a separate concern. */
type LabelTargetType = "shidduch" | "shadchan" | "single" | "connection";

const RESOURCE_FOR_LABEL_TYPE: Record<LabelTargetType, string> = {
  shidduch: "shidduchim",
  shadchan: "shadchanim",
  single: "singles",
  connection: "connections",
};

function isLabelTargetType(
  type: TaskTargetType | undefined,
): type is LabelTargetType {
  return (
    type === "shidduch" ||
    type === "shadchan" ||
    type === "single" ||
    type === "connection"
  );
}

export interface DueReminderRow {
  id: Identifier;
  text: string;
  dueDate: string | null;
  isOverdue: boolean;
  memberId: Identifier | null | undefined;
  /** The record name to show as the row's own record mention. `null` when
   * the task has no linked entity at all (`target_type`/`target_id` unset) —
   * every `TaskTargetType` member is now resolved to a record by either
   * `isLabelTargetType`'s branch or the `reference` branch below. */
  primaryLabel: string | null;
  /** AC-6: for a reference row with a resolved shidduch, "about {shidduch
   * name}" — always paired with `link`, never set on its own. */
  contextLabel: string | null;
  /** Where `primaryLabel` (+ `contextLabel`, when present) should link.
   * `null` renders inert text — the zero-link reference case (AC-6) and the
   * unresolved-target case both degrade this way, never to a guessed path. */
  link: { resource: string; id: Identifier } | null;
}

export interface UseDueRemindersResult {
  isPending: boolean;
  rows: DueReminderRow[];
  overdueCount: number;
  totalCount: number;
}

function collectIds(
  tasks: readonly Task[],
  type: TaskTargetType,
): Identifier[] {
  const ids: Identifier[] = [];
  for (const task of tasks) {
    if (task.target_type !== type || task.target_id == null) continue;
    if (!ids.includes(task.target_id)) ids.push(task.target_id);
  }
  return ids;
}

/**
 * Picks the reference_links row AC-6 resolves a reference to a shidduch
 * through, per reference_id: most recent `created_at`, tie-broken by the
 * highest `id`. Links with no `shidduchim_id` are not candidates — an
 * unattached-to-a-shidduch link is not addressability (mirrors
 * `OutstandingCallsSection.tsx`'s own `shidduchim_id != null` filter).
 */
function pickBestLinkPerReference(
  links: readonly ReferenceLinkSummary[],
): Map<Identifier, ReferenceLinkSummary> {
  const best = new Map<Identifier, ReferenceLinkSummary>();
  for (const link of links) {
    if (link.shidduchim_id == null) continue;
    const current = best.get(link.reference_id);
    if (!current) {
      best.set(link.reference_id, link);
      continue;
    }
    const currentAt = new Date(current.created_at).getTime();
    const candidateAt = new Date(link.created_at).getTime();
    if (
      candidateAt > currentAt ||
      (candidateAt === currentAt && link.id > current.id)
    ) {
      best.set(link.reference_id, link);
    }
  }
  return best;
}

/** The reference's own name, from ANY of its links (the name is the same on
 * every row for a given reference_id). `undefined` when the reference has
 * zero rows in `reference_links` at all — the "unattached reference" case —
 * because that name is only reachable through `references`, which this
 * file never queries (see the module doc comment). */
function pickReferenceName(
  links: readonly ReferenceLinkSummary[],
): Map<Identifier, string | null | undefined> {
  const names = new Map<Identifier, string | null | undefined>();
  for (const link of links) {
    if (!names.has(link.reference_id)) {
      names.set(link.reference_id, link.reference_name_en);
    }
  }
  return names;
}

/**
 * F18 (Epic 12 adversarial review): fetches ONE reference's own links, never
 * a pool shared with other references. The prior implementation ran a
 * single `reference_id@in` query across every visible reference id with one
 * GLOBAL `perPage: 100` — if one heavily-reused reference's links filled
 * that page, a second, sparser reference's own valid link could rank
 * outside the top 100 of the COMBINED set and vanish, even though
 * `perPage: 100` is generous for any one reference on its own. Scoping the
 * query to a single id removes the cross-reference contention entirely:
 * each reference gets its own top-100 pool, sorted by the same
 * `created_at DESC` `pickBestLinkPerReference` already tie-breaks on.
 *
 * Called a FIXED number of times — one call site per slot in
 * `useDueReminders`, below — never inside a loop over a variable-length
 * array (`referenceIds.map(useReferenceLinksForSlot)` would violate the
 * rules of hooks, since the number of hook calls would vary by render).
 */
function useReferenceLinksForSlot(referenceId: Identifier | undefined) {
  return useGetList<ReferenceLinkSummary>(
    "reference_links",
    {
      // AC-5 / `transformInFilter.ts:5-17`: `@in` takes the PostgREST string
      // "(1,5)", never an array. Reused here as a one-element list, rather
      // than switching to `@eq`, so the filter stays the same proven shape
      // as before. `"()"` is the explicit empty-list shape for an empty
      // slot — valid, and moot, since the query is disabled then anyway.
      filter: { "reference_id@in": `(${referenceId ?? ""})` },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 100 },
    },
    { enabled: referenceId != null },
  );
}

export function useDueReminders(): UseDueRemindersResult {
  const { data: tasks, isPending: tasksPending } = useGetList<Task>("tasks", {
    filter: { "done_date@is": null },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });

  const openTasks = useMemo(() => tasks ?? [], [tasks]);

  const overdueCount = useMemo(
    () =>
      openTasks.filter(
        (task) => task.due_date != null && isOverdue(task.due_date),
      ).length,
    [openTasks],
  );

  // Ordering comes free from the query's own `due_date ASC` sort — overdue
  // rows are already the head of the list, so the first MAX_ROWS of the
  // whole (already-sorted) list is exactly what AC-4 wants. Slicing BEFORE
  // resolving labels also means this card only ever fetches labels for the
  // rows it actually renders.
  const visibleTasks = useMemo(() => openTasks.slice(0, MAX_ROWS), [openTasks]);

  const shidduchIds = useMemo(
    () => collectIds(visibleTasks, "shidduch"),
    [visibleTasks],
  );
  const shadchanIds = useMemo(
    () => collectIds(visibleTasks, "shadchan"),
    [visibleTasks],
  );
  const singleIds = useMemo(
    () => collectIds(visibleTasks, "single"),
    [visibleTasks],
  );
  const referenceIds = useMemo(
    () => collectIds(visibleTasks, "reference"),
    [visibleTasks],
  );
  const connectionIds = useMemo(
    () => collectIds(visibleTasks, "connection"),
    [visibleTasks],
  );

  const shidduchim = useGetMany(
    RESOURCE_FOR_LABEL_TYPE.shidduch,
    { ids: shidduchIds },
    { enabled: shidduchIds.length > 0 },
  );
  const shadchanim = useGetMany(
    RESOURCE_FOR_LABEL_TYPE.shadchan,
    { ids: shadchanIds },
    { enabled: shadchanIds.length > 0 },
  );
  const singles = useGetMany(
    RESOURCE_FOR_LABEL_TYPE.single,
    { ids: singleIds },
    { enabled: singleIds.length > 0 },
  );
  // F17: resolved exactly like the three label types above — see this
  // file's `LabelTargetType` doc comment for why `connection` now belongs
  // in this set and what stays out of scope.
  const connections = useGetMany(
    RESOURCE_FOR_LABEL_TYPE.connection,
    { ids: connectionIds },
    { enabled: connectionIds.length > 0 },
  );

  // F18: one query PER reference id (`useReferenceLinksForSlot`'s own
  // comment explains why), never one query pooled across all of them.
  // `MAX_ROWS` fixed call sites, hand-unrolled rather than
  // `referenceIds.map(useReferenceLinksForSlot)` — `visibleTasks` is
  // already capped at `MAX_ROWS` (currently 3) and `collectIds` dedups, so
  // `referenceIds` can never hold more than `MAX_ROWS` entries; add another
  // `useReferenceLinksForSlot(referenceIds[n])` call here if `MAX_ROWS` ever
  // grows.
  const referenceLinksSlot0 = useReferenceLinksForSlot(referenceIds[0]);
  const referenceLinksSlot1 = useReferenceLinksForSlot(referenceIds[1]);
  const referenceLinksSlot2 = useReferenceLinksForSlot(referenceIds[2]);
  const referenceLinks = useMemo(
    () => [
      ...(referenceLinksSlot0.data ?? []),
      ...(referenceLinksSlot1.data ?? []),
      ...(referenceLinksSlot2.data ?? []),
    ],
    [
      referenceLinksSlot0.data,
      referenceLinksSlot1.data,
      referenceLinksSlot2.data,
    ],
  );

  const labelRecordsByKey = useMemo(() => {
    const lookup = new Map<string, Record<string, unknown>>();
    const byType: [LabelTargetType, typeof shidduchim][] = [
      ["shidduch", shidduchim],
      ["shadchan", shadchanim],
      ["single", singles],
      ["connection", connections],
    ];
    byType.forEach(([type, result]) => {
      (result.data ?? []).forEach((record) => {
        lookup.set(`${type}:${record.id}`, record as Record<string, unknown>);
      });
    });
    return lookup;
  }, [shidduchim, shadchanim, singles, connections]);

  const bestLinkByReferenceId = useMemo(
    () => pickBestLinkPerReference(referenceLinks),
    [referenceLinks],
  );
  const referenceNameById = useMemo(
    () => pickReferenceName(referenceLinks),
    [referenceLinks],
  );

  const rows = useMemo<DueReminderRow[]>(
    () =>
      visibleTasks.map((task) => {
        const dueDate = task.due_date ?? null;
        const overdue = dueDate != null && isOverdue(dueDate);
        const base = {
          id: task.id,
          text: task.text,
          dueDate,
          isOverdue: overdue,
          memberId: task.member_id,
        };

        if (isLabelTargetType(task.target_type) && task.target_id != null) {
          const record = labelRecordsByKey.get(
            `${task.target_type}:${task.target_id}`,
          );
          const { label } = targetEntityLabel(task.target_type, record);
          return {
            ...base,
            primaryLabel: label,
            contextLabel: null,
            link: {
              resource: RESOURCE_FOR_LABEL_TYPE[task.target_type],
              id: task.target_id,
            },
          };
        }

        if (task.target_type === "reference" && task.target_id != null) {
          const referenceId = task.target_id;
          const name = referenceNameById.get(referenceId);
          const link = bestLinkByReferenceId.get(referenceId);
          return {
            ...base,
            primaryLabel:
              name || targetEntityLabel("reference", undefined).label,
            contextLabel:
              link && link.shidduchim_id != null
                ? link.shidduch_name_en || `#${link.shidduchim_id}`
                : null,
            link:
              link && link.shidduchim_id != null
                ? { resource: "shidduchim", id: link.shidduchim_id }
                : null,
          };
        }

        // No target at all — the only remaining case now that `shidduch`,
        // `shadchan`, `single` and `connection` are all handled by the
        // generic `isLabelTargetType` branch above and `reference` by its
        // own branch. Never guess a link; render the task's own text with
        // no record mention, exactly like the hub's own "no target" branch
        // (`reminders/` folder, the hook this file deliberately does not
        // import — see the module doc comment above).
        return {
          ...base,
          primaryLabel: null,
          contextLabel: null,
          link: null,
        };
      }),
    [visibleTasks, labelRecordsByKey, referenceNameById, bestLinkByReferenceId],
  );

  const labelsPending =
    (shidduchIds.length > 0 && shidduchim.isPending) ||
    (shadchanIds.length > 0 && shadchanim.isPending) ||
    (singleIds.length > 0 && singles.isPending) ||
    (connectionIds.length > 0 && connections.isPending) ||
    (referenceIds[0] != null && referenceLinksSlot0.isPending) ||
    (referenceIds[1] != null && referenceLinksSlot1.isPending) ||
    (referenceIds[2] != null && referenceLinksSlot2.isPending);

  return {
    isPending: tasksPending || labelsPending,
    rows,
    overdueCount,
    totalCount: openTasks.length,
  };
}

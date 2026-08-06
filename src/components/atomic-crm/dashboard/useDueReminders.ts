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

/** The three target types this card resolves to a real record + name.
 * Deliberately three, not the full five-member `TaskTargetType` union
 * (AC-5's "three, not four" — see this file's own divergence note below for
 * the fifth, `connection`). `reference` is handled on its own path (Query
 * three); it is not a "label" type because it never reads `references`. */
type LabelTargetType = "shidduch" | "shadchan" | "single";

const RESOURCE_FOR_LABEL_TYPE: Record<LabelTargetType, string> = {
  shidduch: "shidduchim",
  shadchan: "shadchanim",
  single: "singles",
};

function isLabelTargetType(
  type: TaskTargetType | undefined,
): type is LabelTargetType {
  return type === "shidduch" || type === "shadchan" || type === "single";
}

export interface DueReminderRow {
  id: Identifier;
  text: string;
  dueDate: string | null;
  isOverdue: boolean;
  memberId: Identifier | null | undefined;
  /** The record name to show as the row's own record mention. `null` when
   * the task has no linked entity this card can resolve (no target, or a
   * target type this card does not fetch — see the `connection` note
   * below). */
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

  // AC-5 / `transformInFilter.ts:5-17`: `@in` takes the PostgREST string
  // "(1,5)", never an array. `"()"` is the explicit empty-list shape, valid
  // even when `referenceIds` is empty (the query is disabled then anyway).
  const referenceIdsFilter = `(${referenceIds.join(",")})`;
  const { data: referenceLinksData, isPending: referenceLinksPending } =
    useGetList<ReferenceLinkSummary>(
      "reference_links",
      {
        filter: { "reference_id@in": referenceIdsFilter },
        sort: { field: "created_at", order: "DESC" },
        pagination: { page: 1, perPage: 100 },
      },
      { enabled: referenceIds.length > 0 },
    );
  const referenceLinks = useMemo(
    () => referenceLinksData ?? [],
    [referenceLinksData],
  );

  const labelRecordsByKey = useMemo(() => {
    const lookup = new Map<string, Record<string, unknown>>();
    const byType: [LabelTargetType, typeof shidduchim][] = [
      ["shidduch", shidduchim],
      ["shadchan", shadchanim],
      ["single", singles],
    ];
    byType.forEach(([type, result]) => {
      (result.data ?? []).forEach((record) => {
        lookup.set(`${type}:${record.id}`, record as Record<string, unknown>);
      });
    });
    return lookup;
  }, [shidduchim, shadchanim, singles]);

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

        // No target at all, or a target type this card does not resolve to
        // a record — currently `connection` only (see the divergence note
        // below). Never guess a link; render the task's own text with no
        // record mention, exactly like the hub's own "no target" branch
        // (`reminders/` folder, the hook this file deliberately does not
        // import — see the module doc comment above).
        //
        // F7 divergence, recorded per the story's instruction: `types.ts`'s
        // `TaskTargetType` (aliasing `EntityTargetType`) now has FIVE
        // members — Story 8.5 added `connection` after this story's Task 1
        // was written as "three, not four". A household context (where
        // this card mounts, Task 3) can hold a connection-targeted task
        // (`reminderEntity.ts`'s own comment: "a household or a shadchan
        // can each hold a private task about their own shared connection").
        // Resolving it would need a fourth `useGetMany("connections", …)`
        // call, which is legal under the AD-24 guard (id-scoped reads are
        // addressability, `ad24Conformance.ts:692-694`) but adds a query
        // and a resource dependency no AC in this story asks for. This
        // card degrades a connection-targeted row to plain text instead —
        // safe (never a wrong link), consistent with the "no target"
        // fallback already used for a null `target_type`, and cheap to
        // widen later if a story actually needs it.
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
    (referenceIds.length > 0 && referenceLinksPending);

  return {
    isPending: tasksPending || labelsPending,
    rows,
    overdueCount,
    totalCount: openTasks.length,
  };
}

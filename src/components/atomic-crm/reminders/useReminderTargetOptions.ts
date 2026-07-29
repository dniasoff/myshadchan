import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { useMemo } from "react";

import type { ReferenceLinkSummary, TaskTargetType } from "../types";
import { RESOURCE_FOR_TARGET, targetEntityLabel } from "./reminderEntity";

const PAGE_100 = { page: 1, perPage: 100 } as const;
const NEWEST_FIRST = { field: "created_at", order: "DESC" } as const;

export interface ReminderTargetOption {
  id: Identifier;
  label: string;
}

export interface ReminderTargetOptions {
  isPending: boolean;
  options: ReminderTargetOption[];
  /** True when the type needs a shidduch that has not been picked yet — the
   * sheet shows the shidduch picker and keeps the entity picker empty. */
  awaitingShidduch: boolean;
}

/**
 * RULING 7: a reference exists only within a shidduch's context, so the
 * reminders hub may not offer a roster of references the user has not reached
 * through a shidduch. Every other linkable type is account-wide and browsable,
 * so a plain roster is legitimate for those.
 */
export const requiresShidduchScope = (type: TaskTargetType): boolean =>
  type === "reference";

/**
 * Options for the reminder's "linked to" picker.
 *
 * Two query shapes, chosen by `requiresShidduchScope`:
 *
 * - **Unscoped** (shidduch, shadchan): the resource's own roster, as before.
 * - **Shidduch-scoped** (reference): `reference_links_summary` filtered to the
 *   chosen shidduch, so the picker can only ever offer references already
 *   attached to it. Before this, picking "Reference" issued a bare
 *   `useGetList("references", { perPage: 100 })` — a scrollable roster of 100
 *   named references with no shidduch anywhere in scope, reachable from
 *   `/reminders`. That was a browse surface under another name.
 *
 * The feature is **rescoped, not removed**: a reminder to call a reference back
 * is a real workflow, and dropping `"reference"` from `LINKABLE_TARGET_TYPES`
 * would have deleted it. Both `useGetList` calls are declared unconditionally
 * (rules of hooks) and gated with `enabled`, so exactly one ever fires.
 */
export const useReminderTargetOptions = (
  linkType: TaskTargetType,
  shidduchId: Identifier | undefined,
): ReminderTargetOptions => {
  const isScoped = requiresShidduchScope(linkType);
  const awaitingShidduch = isScoped && shidduchId == null;

  const { data: plainRows, isPending: plainPending } = useGetList(
    RESOURCE_FOR_TARGET[linkType],
    { pagination: PAGE_100, sort: NEWEST_FIRST },
    { enabled: !isScoped },
  );

  const { data: linkRows, isPending: linkPending } =
    useGetList<ReferenceLinkSummary>(
      "reference_links_summary",
      {
        filter: { shidduchim_id: shidduchId },
        pagination: PAGE_100,
        sort: NEWEST_FIRST,
      },
      { enabled: isScoped && shidduchId != null },
    );

  return useMemo(() => {
    if (!isScoped) {
      return {
        isPending: plainPending,
        awaitingShidduch: false,
        options: (plainRows ?? []).map((record) => ({
          id: record.id as Identifier,
          ...targetEntityLabel(linkType, record as Record<string, unknown>),
        })),
      };
    }

    if (awaitingShidduch) {
      return { isPending: false, awaitingShidduch: true, options: [] };
    }

    // One row per reference<->shidduch link, so a reference cannot repeat
    // within a single shidduch; deduped by reference_id regardless, since the
    // Select keys on it and a duplicate key would be a silent React warning.
    const byReferenceId = new Map<Identifier, ReminderTargetOption>();
    for (const link of linkRows ?? []) {
      if (link.reference_id == null) continue;
      if (byReferenceId.has(link.reference_id)) continue;
      byReferenceId.set(link.reference_id, {
        id: link.reference_id,
        label: link.reference_name_en || "Reference",
      });
    }

    return {
      isPending: linkPending,
      awaitingShidduch: false,
      options: [...byReferenceId.values()],
    };
  }, [
    isScoped,
    awaitingShidduch,
    linkType,
    plainRows,
    plainPending,
    linkRows,
    linkPending,
  ]);
};

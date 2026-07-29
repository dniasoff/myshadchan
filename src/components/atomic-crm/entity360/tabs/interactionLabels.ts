import { format } from "date-fns";

import type { InteractionKind } from "../../types";

/**
 * Format an ISO timestamp (e.g. `interaction.created_at`) as
 * "d MMM yyyy, HH:mm". Moved verbatim from
 * `shidduchim/ShidduchTimeline.tsx` — the only definition in the repo, so no
 * behaviour change. `ShidduchTimeline` and `ReferenceTimeline` (and, from
 * this story, `ActivityTab`) all import this one copy rather than each
 * re-declaring it (AC 7 / single-owner logic,
 * `.../ARCHITECTURE-SPINE.md:190`).
 */
export function formatTimelineDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format(date, "d MMM yyyy, HH:mm");
}

/**
 * i18n-keyed label per `InteractionKind`, under the framework namespace
 * `crm.entity360.activity.kind.<kind>`. Hardcoding an English map at the
 * framework layer is forbidden (contract §13 rule 6, AD-18
 * `.../ARCHITECTURE-SPINE.md:143`) — a consumer renders through
 * `useTranslate()` with the `_:` fallback, exactly as
 * `ReferenceTimeline.tsx` did before this story lifted the shape out of it.
 *
 * `link_created` / `link_removed` read "Linked to a shidduch" / "Unlinked
 * from a shidduch" (AC 7): the only writer of those rows,
 * `link_reference_to_shidduch()` (`02_functions.sql`), always writes
 * `target_type = 'reference'` with `metadata = {shidduchim_id}` — a
 * reference_link joins a reference to a shidduch, never to a single
 * (`ShidduchTimeline`'s old "Linked to a reference") and never a single
 * directly (`ReferenceTimeline`'s old "Linked to a single").
 */
export const INTERACTION_KIND_LABELS: Record<
  InteractionKind,
  { key: string; fallback: string }
> = {
  note: { key: "crm.entity360.activity.kind.note", fallback: "Note" },
  call_logged: {
    key: "crm.entity360.activity.kind.call_logged",
    fallback: "Call logged",
  },
  status_change: {
    key: "crm.entity360.activity.kind.status_change",
    fallback: "Status changed",
  },
  merge: { key: "crm.entity360.activity.kind.merge", fallback: "Merged" },
  link_created: {
    key: "crm.entity360.activity.kind.link_created",
    fallback: "Linked to a shidduch",
  },
  link_removed: {
    key: "crm.entity360.activity.kind.link_removed",
    fallback: "Unlinked from a shidduch",
  },
};

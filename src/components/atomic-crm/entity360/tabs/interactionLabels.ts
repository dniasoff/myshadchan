import { format } from "date-fns";

import type { InteractionKind } from "../../types";

/**
 * Format an ISO timestamp (e.g. `interaction.created_at`) as
 * "d MMM yyyy, HH:mm". Originally lifted verbatim out of the shidduch's own
 * routed-dialog timeline component (Story 3.5) — it was the only definition
 * of this exact function at the time, so the move was behaviour-neutral;
 * that component is gone now (Story 5.1 deleted the dialog it lived in,
 * superseded by the universal Notes/Activity tabs). It is not the only date
 * formatter in the repo (S21): `shidduchim/boardUtils.ts`'s
 * `formatRedtDate` (date-only, no time) and
 * `shidduchim/ShidduchCatchPanel.tsx`'s `formatDateOn` each format a
 * different shape for a different surface — this remains the one shared
 * timestamp formatter for interaction/note/file timelines. `ActivityTab`,
 * `NotesTab` and `FilesTab` all import this one copy rather than each
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
 * reference_link joins a reference to a shidduch, never to a single (the
 * shidduch-side timeline's old label read "Linked to a reference") and
 * never a single directly (the reference-side timeline's old label read
 * "Linked to a single").
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
  single_input: {
    key: "crm.entity360.activity.kind.single_input",
    fallback: "The single's input",
  },
};

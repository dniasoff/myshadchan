/**
 * `EntityTargetType` (`../types.ts`) deliberately runs ahead of three
 * Postgres check constraints that still hold their pre-`single` value sets
 * (contract §8 rule 1 / §10). This ledger is the tracked record of that gap
 * — each entry names a constraint whose widening migration has not landed
 * yet, and the story that owns it. `entity360.pendingDbWidenings.test.ts`
 * reads `supabase/schemas/01_tables.sql` as raw text and asserts every
 * constraint listed here is genuinely still behind; a constraint that has
 * already caught up must be REMOVED here in the same diff as its migration
 * (Stories 3.5, 3.7, 3.8), never left stale. Story 3-15 asserts this array
 * is empty — Epic 3 cannot close with tabs, or target types, still pending.
 */
export const PENDING_DB_WIDENINGS = [
  // interactions_target_type_check reached parity in Story 3.5 — removed here
  // in the same diff as its migration (widen_interactions_targets.sql).
  // tasks_target_type_check reached parity in Story 3.8 — removed here in the
  // same diff as its migration (widen_tasks_target_type.sql).
  // entity_files_target_type_check — the table does not exist yet; Story 3.7 creates it at parity.
  "entity_files_target_type_check",
] as const;

export type PendingDbWidening = (typeof PENDING_DB_WIDENINGS)[number];

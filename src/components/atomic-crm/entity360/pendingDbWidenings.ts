/**
 * `EntityTargetType` (`../types.ts`) deliberately ran ahead of three
 * Postgres check constraints while their widening migrations had not yet
 * landed (contract §8 rule 1 / §10). This ledger is the tracked record of
 * that gap — each entry names a constraint whose widening migration has not
 * landed yet, and the story that owns it. `entity360.pendingDbWidenings.test.ts`
 * reads `supabase/schemas/01_tables.sql` as raw text and asserts every
 * constraint listed here is genuinely still behind; a constraint that has
 * already caught up must be REMOVED here in the same diff as its migration
 * (Stories 3.5, 3.7, 3.8), never left stale. Story 3-15 asserts this array
 * is empty — Epic 3 cannot close with tabs, or target types, still pending.
 *
 * Empty as of Story 3.7: interactions_target_type_check (3.5) and
 * tasks_target_type_check (3.8) both reached parity and were removed here in
 * the same diff as their migrations. entity_files_target_type_check never
 * belonged here at all — the table ships at full four-value parity FROM
 * CREATION (Story 3.7, AC 2a), so it was never actually behind.
 */
export const PENDING_DB_WIDENINGS = [] as const;

export type PendingDbWidening = (typeof PENDING_DB_WIDENINGS)[number];

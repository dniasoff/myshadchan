/**
 * Shared types for the admin bulk-reseed orchestrator. Kept in one place so
 * `index.ts`, `reseedAccount.ts` and their tests all agree on the same
 * shapes.
 */

export interface TempUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Result of a cleanup step (removing the temp membership, deleting the temp
 * user) that must never throw — cleanup runs unconditionally for every
 * account, including ones that already failed, so a thrown cleanup error
 * would either mask the real failure or abort cleanup for accounts
 * processed later. Callers combine the `error` message into the account's
 * `cleanupWarning` instead of swallowing it.
 */
export type CleanupResult = { ok: true } | { ok: false; error: string };

/**
 * - "ok"      — clear_demo and seed_demo both completed and the account
 *               ended fully re-seeded.
 * - "error"   — clear_demo/seed_demo were actually invoked (at least once)
 *               but the account did not end up fully re-seeded.
 * - "skipped" — a pre-flight guard (temp user creation, membership setup,
 *               or the account-identity confirmation in reseedAccount.ts)
 *               refused to touch the account at all. Nothing was cleared
 *               or seeded — the account's existing data is untouched.
 */
export type AccountStatus = "ok" | "error" | "skipped";

/**
 * - "seeded"         — the account ended this run with fresh demo data in
 *                       place.
 * - "wiped_unseeded" — clear_demo succeeded but seed_demo never completed,
 *                       so the account is currently EMPTY. clear_demo ->
 *                       seed_demo is not transactional; this is the state
 *                       that needs a manual seed_demo re-run (or another
 *                       pass of this function) to fix.
 * - "unknown"        — clear_demo was never confirmed to have run (a
 *                       pre-flight guard stopped first, or clear_demo
 *                       itself failed before completing), so this run did
 *                       not change the account's existing data either way.
 */
export type DataState = "seeded" | "wiped_unseeded" | "unknown";

export interface AccountResult {
  accountId: number;
  accountKind: string;
  status: AccountStatus;
  dataState: DataState;
  cleared: boolean;
  seeded: boolean;
  /** Timestamp returned by the successful clear finalizer. It is omitted
   * when clear never completed; callers must not synthesize one locally. */
  lastClearedAt?: string;
  summary?: Record<string, unknown>;
  error?: string;
  /** Non-fatal: the account's own data is whatever `dataState` says, but
   * the temp scaffolding (membership row and/or temp auth user) used to
   * process it could not be torn down and needs manual cleanup. */
  cleanupWarning?: string;
}

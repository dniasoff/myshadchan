import { resolveAccountId } from "../_shared/resolveDemoAccount.ts";
import { getErrorMessage } from "./errorMessage.ts";
import { ClearSeedError, clearAndSeedWithRetry } from "./invokeDemoFunction.ts";
import {
  addTempMembership,
  removeTempMembership,
  roleForAccountKind,
  setTempActiveAccount,
} from "./membership.ts";
import { createTempUser, deleteTempUser, signInTempUser } from "./tempUser.ts";
import type { AccountResult, DataState, TempUser } from "./types.ts";

type Outcome = Omit<
  AccountResult,
  "accountId" | "accountKind" | "cleanupWarning"
>;

function skippedOutcome(error: string): Outcome {
  return {
    status: "skipped",
    dataState: "unknown",
    cleared: false,
    seeded: false,
    error,
  };
}

function failedOutcome(cleared: boolean, error: string): Outcome {
  const dataState: DataState = cleared ? "wiped_unseeded" : "unknown";
  return { status: "error", dataState, cleared, seeded: false, error };
}

/** Removes the temp membership row, logging and returning its error message
 * (never throwing) instead of swallowing a cleanup failure. Returns `null`
 * on success or when there was never a membership to remove. */
async function cleanupMembership(
  membershipId: number | undefined,
): Promise<string | null> {
  if (membershipId == null) return null;
  const removed = await removeTempMembership(membershipId);
  if (removed.ok) return null;
  console.error(`admin_reseed_demo_accounts: ${removed.error}`);
  return removed.error;
}

/** Deletes the temp auth user, logging and returning its error message
 * (never throwing) instead of swallowing a cleanup failure. Returns `null`
 * on success or when there was never a temp user to delete. */
async function cleanupTempUser(
  tempUser: TempUser | undefined,
): Promise<string | null> {
  if (!tempUser) return null;
  const deleted = await deleteTempUser(tempUser.id);
  if (deleted.ok) return null;
  console.error(`admin_reseed_demo_accounts: ${deleted.error}`);
  return deleted.error;
}

/**
 * Runs the temp-user setup, identity confirmation, and clear+seed retry for
 * one account, then unconditionally tears the temp scaffolding down. Cleanup
 * is deliberately NOT a `try/finally` around a `return` — ESLint's
 * no-unsafe-finally concern aside, a `finally` cannot amend an
 * already-committed return value without mutating it. Instead the whole
 * attempt resolves to an `Outcome` first (the inner async block below never
 * throws outward — every path is caught), and cleanup runs afterward,
 * unconditionally, to build the final immutable result.
 */
export async function reseedAccount(
  accountId: number,
  accountKind: string,
): Promise<AccountResult> {
  let tempUser: TempUser | undefined;
  let membershipId: number | undefined;

  const outcome = await (async (): Promise<Outcome> => {
    try {
      tempUser = await createTempUser();
      const accessToken = await signInTempUser(
        tempUser.email,
        tempUser.password,
      );
      membershipId = await addTempMembership(
        tempUser.id,
        accountId,
        roleForAccountKind(accountKind),
      );
      await setTempActiveAccount(tempUser.id, accountId);

      // Defense-in-depth confirmation that we are about to operate on the
      // account we intend to, not whatever `resolveAccountId` happens to
      // resolve to. With a fresh temp user per account (tempUser.ts) this
      // should always match; a mismatch means something is structurally
      // wrong (e.g. a stale membership row this same user id somehow
      // already held, or a concurrent invocation of this function) and the
      // account must NOT be touched on an unverified target — refuse
      // instead of proceeding.
      const resolved = await resolveAccountId(tempUser.id);
      if (resolved !== accountId) {
        return skippedOutcome(
          `refusing to operate on account ${accountId}: temp user resolved to account ${
            resolved ?? "none"
          } instead (possible stale membership or concurrent run)`,
        );
      }

      const result = await clearAndSeedWithRetry(accessToken);
      return {
        status: "ok",
        dataState: "seeded",
        cleared: result.cleared,
        seeded: result.seeded,
        summary: result.summary,
      };
    } catch (e) {
      console.error(
        `admin_reseed_demo_accounts: account ${accountId} failed:`,
        e,
      );
      if (e instanceof ClearSeedError) {
        return failedOutcome(e.cleared, e.message);
      }
      // Anything else (temp user creation, sign-in, membership setup)
      // failed before clear_demo/seed_demo were ever invoked — the account
      // itself was never touched, so this is a skip, not an error.
      return skippedOutcome(getErrorMessage(e));
    }
  })();

  // Membership removal runs before temp-user deletion (never in parallel):
  // if the account_members row somehow already vanished, that is a cleanup
  // failure worth reporting on its own rather than racing the two deletes.
  const membershipWarning = await cleanupMembership(membershipId);
  const tempUserWarning = await cleanupTempUser(tempUser);
  const cleanupWarning = [membershipWarning, tempUserWarning]
    .filter((warning): warning is string => warning !== null)
    .join("; ");

  return {
    accountId,
    accountKind,
    ...outcome,
    cleanupWarning: cleanupWarning.length > 0 ? cleanupWarning : undefined,
  };
}

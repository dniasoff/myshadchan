const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export async function invokeFunction(
  name: "clear_demo" | "seed_demo",
  accessToken: string,
  requestBody?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // The functions themselves fall back to SUPABASE_ANON_KEY if
      // SB_PUBLISHABLE_KEY is absent, but passing apikey keeps the header
      // self-contained and mirrors how userScopedClient constructs its client.
      apikey: SUPABASE_ANON_KEY,
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const responseBody = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(responseBody);
  } catch {
    json = { raw: responseBody };
  }
  if (!res.ok) {
    throw new Error(`${name} returned ${res.status}: ${responseBody}`);
  }
  return json;
}

// Initial attempt + one retry. clear_demo/seed_demo are themselves
// idempotent single calls; this bounds the retry to a small, fixed cost
// rather than looping indefinitely against a persistently broken account.
const MAX_CLEAR_SEED_ATTEMPTS = 2;

/**
 * Thrown once every clear+seed attempt has been exhausted. Carries whether
 * the LAST attempt's clear_demo call completed, so the caller can report
 * whether the account was left wiped-but-unseeded (dangerous: the account
 * currently has no demo data at all) versus never having been touched.
 */
export class ClearSeedError extends Error {
  readonly cleared: boolean;
  constructor(cleared: boolean, message: string) {
    super(message);
    this.name = "ClearSeedError";
    this.cleared = cleared;
  }
}

/**
 * clear_demo -> seed_demo is not transactional: a crash between the two
 * calls (or partway through seed_demo) leaves the account wiped but
 * unseeded. Retrying the WHOLE pair — never seed_demo alone — is what
 * closes that gap for ordinary transient failures: seed_demo's own
 * empty-account guard would otherwise refuse to run a second time on top
 * of whatever partial data the first, failed seed_demo call already
 * inserted, permanently stranding the account in the wiped state. Running
 * clear_demo again first resets to empty so the retry has the same clean
 * starting point as the first attempt.
 *
 * Throws `ClearSeedError` (never a bare `Error`) once every attempt has
 * been exhausted, so the caller always learns whether the account was left
 * cleared.
 */
export async function clearAndSeedWithRetry(accessToken: string): Promise<{
  cleared: true;
  seeded: true;
  summary: Record<string, unknown>;
}> {
  let lastCleared = false;
  let lastMessage = "clear_demo/seed_demo did not run";

  for (let attempt = 1; attempt <= MAX_CLEAR_SEED_ATTEMPTS; attempt++) {
    let cleared = false;
    try {
      // Explicit opt-OUT, not an omission: this is a REFRESH of a demo
      // account, which must REMAIN a demo account so it stays in the
      // reseed pool (see clear_demo/index.ts's module docstring for the
      // full two-caller contract). clear_demo already defaults to `false`
      // when the flag is absent, so this `false` is redundant with that
      // default today — it is written out anyway so a future reader can't
      // "helpfully" flip it to `true` here without visibly contradicting
      // this comment, which would silently drain the reseed pool.
      const clearResult = await invokeFunction("clear_demo", accessToken, {
        releaseDemoFlag: false,
      });
      cleared = clearResult.cleared === true;
      if (!cleared) {
        throw new Error("clear_demo did not report cleared: true");
      }

      const seedResult = await invokeFunction("seed_demo", accessToken);
      if (seedResult.seeded !== true) {
        throw new Error(
          `seed_demo did not report seeded: true (reason: ${String(
            seedResult.reason ?? "unknown",
          )})`,
        );
      }
      return { cleared: true, seeded: true, summary: seedResult };
    } catch (e) {
      lastCleared = cleared;
      lastMessage = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_CLEAR_SEED_ATTEMPTS) {
        console.error(
          `admin_reseed_demo_accounts: clear+seed attempt ${attempt} failed, retrying:`,
          e,
        );
      }
    }
  }

  throw new ClearSeedError(lastCleared, lastMessage);
}

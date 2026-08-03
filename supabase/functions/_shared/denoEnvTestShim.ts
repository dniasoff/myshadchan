/**
 * Minimal `Deno.env.get` shim for the "functions" Vitest project
 * (vitest.config.ts) — a `setupFiles` entry for that project only.
 *
 * Every `supabase/functions/**` module reads its configuration through the
 * real Deno runtime's global `Deno.env.get(...)`, which does not exist under
 * Node. Before Story 10.3, nothing tested under this project ever called
 * `Deno.env.get` at all (`addNoteToContact.test.ts`'s mocking only ever
 * covered `supabaseAdmin.from`, never a direct env read) — so this gap was
 * never exercised. `postmark/index.ts`'s AC 7 ("a still-missing env var
 * produces a per-request 500") is the first test that needs to control what
 * `Deno.env.get` returns, and it does so through `vi.stubEnv`, which Vitest
 * backs with `process.env` in a Node environment — so this shim forwards
 * `Deno.env.get(key)` to `process.env[key]`, making `vi.stubEnv`/
 * `vi.unstubAllEnvs()` the one, already-idiomatic way to drive it.
 *
 * Guarded so it is a no-op if `Deno` is ever real (never true here, but
 * cheap insurance against silently shadowing a genuine global).
 */
type DenoEnvShim = { env: { get(key: string): string | undefined } };

if (typeof (globalThis as { Deno?: unknown }).Deno === "undefined") {
  (globalThis as { Deno?: DenoEnvShim }).Deno = {
    env: { get: (key: string) => process.env[key] },
  };
}

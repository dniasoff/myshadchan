import { describe, expect, it } from "vitest";

/**
 * Story 7.5 AC-10 / F3 review fix. 12-2's AC-7 ruling (adopted here, see the
 * story's "Two of 12-2's rulings override this story's earlier text") is:
 * the cron Worker issues no table query at all — every read and write goes
 * through `service_role`-only `SECURITY DEFINER` RPCs, because AD-7 grants
 * it no `forAccount()` cross-tenant exemption. AC-10's own falsifiable
 * clause names the mechanism: "a `?raw` source scan asserts no `.from(`
 * appears in this story's Worker files. Prove the scan red against a
 * deliberately broken fixture before shipping it green (contract §13 rule
 * 2)." No such test existed before this fix — this file is what closes it.
 *
 * Scoped to `workers/cron/**\/*.ts` (not `workers/shared/**`): `forAccount.ts`
 * there legitimately wraps `.from(` for whichever callers still use the
 * older per-row-scoping mechanism, and is outside this story's declared
 * file set regardless.
 *
 * The scan is a blunt substring match on `.from(`, exactly as AC-10 states
 * it — not a parser, so it also catches a violation hidden in a template
 * string or split across a trivial reformat. The trade-off, proven live
 * rather than assumed: `webPush.ts` used to carry the literal substring
 * `.from(...)` in its own JSDoc (documenting the very rule this guard now
 * enforces), which a blunt scan cannot tell from a real call — reworded as
 * part of this fix so the guard's own subject file does not trip it.
 */

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const nonTestCronSources = Object.entries(sources).filter(
  ([path]) => !path.includes(".test.") && !path.endsWith(".d.ts"),
);

/** Proven red against a synthetic broken fixture below before it is ever
 * trusted green against the real Worker files. */
export function findTenantTableAccess(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, content]) => content.includes(".from("))
    .map(([path]) => path);
}

describe("cron worker guard — the scan itself is falsifiable", () => {
  it("finds this Worker's own files, at minimum ./webPush.ts and ./index.ts", () => {
    // Assert — proves the glob is rooted correctly and non-empty BEFORE any
    // "appears nowhere" assertion below is allowed to mean anything.
    const paths = nonTestCronSources.map(([path]) => path);
    expect(paths.some((path) => path.endsWith("/webPush.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/index.ts"))).toBe(true);
  });

  it("findTenantTableAccess is red against a deliberately broken fixture", () => {
    // Arrange / Act / Assert — a fixture shaped like the exact violation
    // AC-10 forbids: a Supabase client reading a tenant table directly.
    expect(
      findTenantTableAccess({
        "./sweepMessages.ts":
          'const rows = await client.from("push_subscriptions").select("*");',
      }),
    ).toEqual(["./sweepMessages.ts"]);
  });

  it("findTenantTableAccess is green against a clean fixture", () => {
    expect(
      findTenantTableAccess({
        "./sweepMessages.ts":
          'const rows = await client.rpc("claim_message_notifications", { p_limit: 100 });',
      }),
    ).toEqual([]);
  });
});

describe("cron worker guard — no .from( in any workers/cron/**/*.ts (AC-10)", () => {
  it("reports zero offenders across the real Worker source", () => {
    // Arrange
    const files = Object.fromEntries(nonTestCronSources);

    // Act
    const offenders = findTenantTableAccess(files);

    // Assert
    expect(
      offenders,
      `Tenant table access found outside a service_role RPC: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

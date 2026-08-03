import type { DataProvider, Identifier } from "ra-core";

import {
  resolveContextMembership,
  type GetIdentity,
} from "./accountMemberships";

/**
 * FakeRest has no BEFORE INSERT trigger, so the CSPRNG-token guarantee
 * `set_share_link_token_defaults()` (02_functions.sql, Story 9.5, AC-2)
 * makes in Postgres — `token` is ALWAYS overwritten with a fresh value
 * regardless of what a client supplies, and `account_id` is server-derived
 * from the caller's active context — is hand-emulated here instead, the
 * same "hand-written twin of a Postgres-only behavior" pattern
 * `internal/listingWithdrawal.ts` (Story 9.3) already establishes for this
 * directory. `created_by_member_id` is stamped the same way
 * `actor_member_id` is elsewhere in this file: the caller's own resolved
 * membership id, or `null` when no identity/membership resolves at all.
 *
 * `CreateShareLinkDialog.tsx` never sends `token`/`account_id`/
 * `created_by_member_id` itself (mirrors the real client's own behaviour —
 * see that component's own doc comment), so in practice this only ever
 * ADDS fields a well-behaved caller omitted. It still overwrites a
 * client-supplied `token` if one WERE sent, matching AC-2's "even a raw
 * insert" guarantee.
 *
 * FakeRest cannot emulate the `share/` Worker's proxy stream at all — there
 * is no Cloudflare Workers runtime in the browser bundle this demo build
 * ships, and no anon-reachable RPC exists for it either (AD-1's "the only
 * anon-readable relation is `listings`"). The public `/share#<token>`
 * recipient page is exercised only by the Worker's own Vitest suite
 * (`workers/share/index.test.ts`), never through `make start-demo` — a
 * share link created in the demo build has no live recipient page that can
 * actually resolve it. A future contributor should not go looking for that
 * wiring in this directory.
 */
export async function stampShareLinkDefaults(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const identity = await getIdentity();
  const userId = identity == null ? null : String(identity.id);
  const membership = userId
    ? await resolveContextMembership(
        baseDataProvider,
        userId,
        getActiveAccountId(),
      )
    : null;

  return {
    ...data,
    account_id: membership?.account_id ?? getActiveAccountId() ?? 1,
    created_by_member_id: membership?.id ?? null,
    token: generateShareLinkToken(),
  };
}

/**
 * A 192-bit CSPRNG token, hex-encoded — the same shape
 * `set_share_link_token_defaults()`'s `encode(gen_random_bytes(24), 'hex')`
 * produces server-side. `crypto.getRandomValues` is the browser's own
 * CSPRNG (this module runs in the SPA bundle, never Node).
 */
function generateShareLinkToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

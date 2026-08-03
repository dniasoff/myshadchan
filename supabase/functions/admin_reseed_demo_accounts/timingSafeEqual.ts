/**
 * Constant-time string comparison for the `ADMIN_RESEED_SECRET` bearer-token
 * check in index.ts. The original version compared the incoming header to
 * the expected secret with a plain `!==`, which short-circuits at the first
 * differing byte — a byte-at-a-time timing side channel on the ONLY gate in
 * front of a destructive, account-wide clear+reseed of every demo account.
 *
 * Deliberately duplicated rather than imported from
 * `../postmark/timingSafeEqual.ts` (which does the same thing for that
 * function's own Basic-Auth secret): this fix's declared path is
 * `supabase/functions/admin_reseed_demo_accounts/**` only, and reaching into
 * a sibling function's directory — rather than a genuine `_shared/` module —
 * would couple two independently-deployed edge functions together for no
 * benefit. Extracting this into `_shared/` so both call sites share one
 * implementation is a good follow-up; it is out of scope here because
 * `_shared/` is outside this fix's declared paths (see the review notes).
 *
 * No native constant-time string compare exists in the Edge Runtime
 * (`crypto.subtle` has no such primitive, and Deno does not ship
 * `node:crypto`'s `timingSafeEqual` here) — this is the standard
 * accumulate-with-XOR shape used where neither is available.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  // A length mismatch is allowed to be visible (it leaks nothing about
  // *content*, only that the lengths differ) — what must not be visible is
  // WHERE in the content two equal-length values first diverge. The
  // comparison loop below always runs the full length of the longer input,
  // never returning early on a content difference.
  let mismatch = aBytes.length === bBytes.length ? 0 : 1;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0;
    const y = i < bBytes.length ? bBytes[i] : 0;
    mismatch |= x ^ y;
  }
  return mismatch === 0;
}

/**
 * Story 10.3 review fix (F-D, non-blocking/medium): `index.ts` used to
 * compare the incoming `Authorization` header to the expected Basic-Auth
 * value with `!==`, a plain string compare that short-circuits at the first
 * differing byte. On a public, unauthenticated endpoint whose only real
 * control is this secret (the IP allowlist below it is a weaker,
 * defense-in-depth check — see that file's own comment), a byte-at-a-time
 * timing side-channel is the wrong risk to accept for free. This compares
 * every byte of both inputs regardless of where they first differ.
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

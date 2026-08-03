import { APP_URL, expect, test } from "./fixtures";

/**
 * Story 9.4 review fix (F5): `PublicSearchPage.test.tsx` (a unit suite,
 * mocked `loadListings`) and `publicListingsClient.test.ts` (a unit suite,
 * mocked Supabase client) both pass even when `/find` is wired to nothing
 * and even when the client silently swaps to a session-bearing Supabase
 * client (review findings F1/F2) — neither ever runs a real query against a
 * real, RLS-enforced database as a real browser session. This spec is the
 * one place in the repo's vocabulary that actually does: it drives the real
 * dev server against the real e2e Supabase stack, with NO `signIn()` call
 * in the first test (a genuinely anonymous browser context) and a real
 * `signIn()` in the second (to prove F2's specific regression shape can't
 * recur).
 */

test("an unauthenticated visitor finds a published shadchan listing at /find (AC-1, AC-2, review finding F1)", async ({
  page,
  createListing,
}) => {
  const listing = await createListing({
    shadchan_name: `Rivka Klein ${Date.now()}`,
    shadchan_area: "Lakewood and nearby",
  });

  // No signIn() call — this is the app's real entry point with no session
  // at all, the same as any visitor arriving from a shared link.
  await page.goto(`${APP_URL}/find`);

  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.getByRole("searchbox").fill(listing.shadchan_name!);

  // AC-1/AC-2: the published listing's opted-in fields render, reached
  // with an anon-column-grant query, never a `select("*")` a real anon
  // role is refused for (F1's exact failure mode — a mocked client can't
  // surface a real-database permission error).
  await expect(page.getByText(listing.shadchan_name!)).toBeVisible();
  await expect(page.getByText("Lakewood and nearby")).toBeVisible();
});

test("a signed-in visitor at /find still sees a listing outside their own account (review finding F2)", async ({
  page,
  createMember,
  createSingle,
  createListing,
  signIn,
}) => {
  // Own household — the account a signed-in visitor's session is scoped
  // to. F2's bug narrowed `/find`'s results down to exactly this account.
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-public-search-signed-in-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Own Household Single" });

  // A DIFFERENT account's published listing — must still be findable.
  const foreignListing = await createListing({
    shadchan_name: `Bracha Foreign ${Date.now()}`,
  });

  await signIn(page, member.email!);

  // Navigate straight to /find in the SAME (now authenticated) browser
  // context — `App.tsx` checks this before `<LandingGate>`/`<CRM>` ever
  // mount, but the query itself must still go out as `anon`, not
  // `authenticated`, regardless of the session sitting in localStorage.
  await page.goto(
    `${APP_URL}/find?q=${encodeURIComponent(foreignListing.shadchan_name!)}`,
  );

  await expect(page.getByText(foreignListing.shadchan_name!)).toBeVisible();
});

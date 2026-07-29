import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 4.4 AC-7. Paths are the literal AC-1 order, hardcoded rather than
 * imported from `layout/navItems.ts` — the same reason `pipeline.spec.ts`
 * hardcodes "Shidduchim" instead of reading the nav module: this spec must
 * fail loudly if the two ever drift apart.
 *
 * Review finding F5: a bare non-empty check passes even if two routes'
 * components were swapped (each still renders *a* non-empty heading, just
 * the wrong one). Each path is paired with a matcher that only that route's
 * real heading satisfies — "Chaya's shidduchim" for `/` (the dashboard
 * greeting, once a single exists), `/redts$/` for `/shidduchim`, and each
 * list page's plural resource name elsewhere — so this spec fails loudly on
 * a swap, not just on a blank screen.
 *
 * A matcher is the route's *stable domain noun*, never the full page copy.
 * `/shidduchim` is why: its heading used to be the literal "Pipeline", and
 * Story 4.3 Task 7 made it the dynamic "{n} redts", which turned that pin
 * red on both projects. The count is 4.3's copy to change; the trailing
 * noun is what makes the heading recognisably this route's and no other's,
 * so the regex anchors on the noun and stays silent about the number — the
 * same matcher, for the same reason, as `ShidduchimList.test.tsx`'s
 * `getByRole("heading", { name: /redts$/ })`. Keep the two in step.
 */
const PRIMARY_NAV_HEADINGS: Record<string, string | RegExp> = {
  "/": "shidduchim",
  "/inbox_items": "Inbox",
  "/shidduchim": /redts$/,
  "/shadchanim": "Shadchanim",
  "/tasks": "Tasks",
  "/reminders": "Reminders",
  "/settings": "Settings",
};

test("every primary nav destination renders its own heading", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-navigation-${Date.now()}@example.com`,
  });
  // The dashboard and the shidduchim board only render their own heading
  // once the account has at least one single.
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  for (const [path, expectedText] of Object.entries(PRIMARY_NAV_HEADINGS)) {
    await page.goto(`${APP_URL}/#${path}`);

    // `level: 1` + a `name` filter (substring for a string, `.test()` for a
    // RegExp), not "the first `<h1>` on the page": some routes carry
    // more than one — the mobile dashboard's app-title bar (`MobileDashboard`
    // Wrapper) sits above the page's own "Chaya's shidduchim" heading, and
    // `admin/list.tsx` leaves a second, EMPTY `<h2>` on every `title={false}`
    // list screen (InboxList.tsx's own comment — "that renderer bug is
    // shared with 4 other screens and is fixed centrally, not here"). Naming
    // the expected text finds the route's own heading regardless of how many
    // other headings share the page, rather than trusting DOM order.
    const heading = page.getByRole("heading", { level: 1, name: expectedText });
    await expect(heading).toBeVisible();
  }
});

test("references has no nav entry on either surface (RULING 7)", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-navigation-refs-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  // Desktop: no "References" link anywhere in the app shell (the Sidebar).
  await expect(page.getByRole("link", { name: "References" })).toHaveCount(0);

  // Mobile only: the bottom nav's "More" menu is the one place a
  // References item used to live.
  if (test.info().project.name === "Mobile Chrome") {
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("menuitem", { name: "References" }),
    ).toHaveCount(0);
  }
});

test("the context switcher is reachable on both surfaces for a 2-context user", async ({
  page,
  createMember,
  createSingle,
  createSecondContext,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-navigation-context-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });
  await createSecondContext({ member, name: "Ada's Shadchanus" });

  await signIn(page, member.email!);

  if (test.info().project.name === "Mobile Chrome") {
    // No persistent TopBar pill on mobile — the switcher lives inside the
    // bottom nav's "More" menu (Story 4.4 NFR-14).
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByText("Ada's Shadchanus", { exact: false }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: /Switch context/ }),
    ).toBeVisible();
  }
});

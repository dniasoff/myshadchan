import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 4.4 AC-7. Paths are the literal AC-1 order, hardcoded rather than
 * imported from `layout/navItems.ts` — the same reason `pipeline.spec.ts`
 * hardcodes "Shidduchim" instead of reading the nav module: this spec must
 * fail loudly if the two ever drift apart.
 */
const PRIMARY_NAV_PATHS = [
  "/",
  "/inbox_items",
  "/shidduchim",
  "/shadchanim",
  "/tasks",
  "/reminders",
  "/settings",
];

test("every primary nav destination renders a non-empty heading", async ({
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

  for (const path of PRIMARY_NAV_PATHS) {
    await page.goto(`${APP_URL}/#${path}`);

    // `level: 1` matters: `admin/list.tsx` leaves a second, EMPTY `<h2>` on
    // every `title={false}` list screen (InboxList.tsx's own comment — "that
    // renderer bug is shared with 4 other screens and is fixed centrally,
    // not here"), which would otherwise be the first heading found and make
    // this assertion pass vacuously on an empty string. Every real page
    // heading on these seven routes is an `<h1>`.
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading).toBeVisible();
    const text = await heading.textContent();
    expect(text?.trim().length ?? 0).toBeGreaterThan(0);
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

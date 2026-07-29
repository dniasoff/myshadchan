import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Story 4.5. AC-1 (reachable from everywhere, one overlay instance),
 * AC-2 (results grouped by resource, rendered as a real link) and AC-5 (a
 * 1-character query does nothing expensive) — the three ACs this spec is
 * responsible for per the story's Task 5 (unit/DB coverage owns AC-3/AC-4).
 *
 * `openGlobalSearch*` helpers branch on the Playwright project rather than
 * duplicating every test per platform: desktop has two independent
 * triggers (the TopBar icon, Cmd/Ctrl+K); mobile has exactly one (the
 * bottom bar's "More" menu — `layout/MobileNavigation.tsx` has no keyboard
 * shortcut).
 */

const SEARCH_PLACEHOLDER = /Search singles, shidduchim, shadchanim/;

async function openGlobalSearchViaIcon(page: Page) {
  await page.getByRole("button", { name: "Search" }).click();
}

async function openGlobalSearchViaShortcut(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
}

async function openGlobalSearchViaMoreMenu(page: Page) {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Search" }).click();
}

test("desktop: opens via the TopBar icon, finds a single by name, and navigates to their page", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "Mobile Chrome",
    "desktop-only trigger — the TopBar icon button",
  );

  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-global-search-icon-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Zissy" });

  await signIn(page, member.email!);
  await openGlobalSearchViaIcon(page);

  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill("Zissy");

  // AC-2: grouped under the "Singles" heading, rendered as a real link.
  await expect(page.getByText("Singles", { exact: true })).toBeVisible();
  const resultLink = page.getByRole("link", { name: /Zissy/ });
  await expect(resultLink).toBeVisible();

  await resultLink.click();

  // AC-1/AC-3: navigates to the single's own page and closes the dialog.
  await expect(page).toHaveURL(new RegExp(`/singles/${single.id}/show`));
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("desktop: Cmd/Ctrl+K opens the same dialog as the icon button", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "Mobile Chrome",
    "desktop-only trigger — the Cmd/Ctrl+K shortcut",
  );

  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-global-search-shortcut-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await openGlobalSearchViaShortcut(page);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("mobile: opens via the bottom bar's More menu Search item", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "Mobile Chrome",
    "mobile-only trigger — the bottom bar's More menu",
  );

  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-global-search-mobile-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await openGlobalSearchViaMoreMenu(page);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a 1-character query never shows a loading state (AC-5)", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-global-search-minlen-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  if (testInfo.project.name === "Mobile Chrome") {
    await openGlobalSearchViaMoreMenu(page);
  } else {
    await openGlobalSearchViaIcon(page);
  }

  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill("c");

  // AC-5's own failure mode is a data-provider call for a 1-character
  // query; the visible symptom of that would be the loading state ever
  // appearing. It never fires the fan-out, so it never appears — asserted
  // immediately (not after a wait) since "never" cannot be proven by
  // waiting past a window that does not exist for this guard.
  await expect(page.getByText("Searching…")).toHaveCount(0);

  // Deterministic settle: the debounce elapses and the guard resolves to
  // an empty result, landing on the no-results state (never the hint,
  // since the field is non-empty; never a result, since nothing this short
  // is searched for).
  await expect(page.getByText("No results")).toBeVisible();
});

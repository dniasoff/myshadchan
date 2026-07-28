import { test, expect } from "./fixtures";

// The only e2e smoke spec (AC-7): sign in via the passwordless email-OTP form
// (story 2.6) and reach the shidduchim pipeline board. Runs on both
// Playwright projects (chromium, Mobile Chrome) since the "Pipeline" nav
// entry is shared between the desktop Sidebar and the mobile bottom nav via
// the same PRIMARY_NAV list.
test("member signs in and sees the pipeline board", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-pipeline-${Date.now()}@example.com`,
  });

  // The pipeline route renders a "no singles yet" empty state instead of the
  // board when the account has zero singles, so the seed is what makes the
  // board assertion meaningful.
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  await page.getByRole("link", { name: "Pipeline" }).click();

  const board = page.locator('[data-tour="pipeline-board"]');
  await expect(board).toBeVisible();
  await expect(board.getByText("New", { exact: true })).toBeVisible();
});

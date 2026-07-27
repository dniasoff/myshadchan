import { test, expect } from "./fixtures";

// The only e2e smoke spec (AC-7): sign in with email/password and reach the
// shidduchim pipeline board. Runs on both Playwright projects (chromium,
// Mobile Chrome) since the "Pipeline" nav entry is shared between the
// desktop Sidebar and the mobile bottom nav via the same PRIMARY_NAV list.
test("member signs in and sees the pipeline board", async ({
  page,
  createMember,
  createSingle,
}) => {
  const password = "e2e-Pipeline-Sm0ke!";
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-pipeline-${Date.now()}@example.com`,
    password,
  });

  // The pipeline route renders a "no singles yet" empty state instead of the
  // board when the account has zero singles, so the seed is what makes the
  // board assertion meaningful.
  await createSingle({ member, first_name_en: "Chaya" });

  await page.goto("http://localhost:5175/#/login");
  await page.getByLabel("Email").fill(member.email!);
  // Not getByLabel("Password"): PasswordInput's FormControl Slot lands its id
  // on the wrapping <div> (it has two children — the input and the reveal
  // toggle), not on the <input>, so the label never associates with the real
  // field and getByLabel("Password") instead matches the "Show password"
  // toggle button's aria-label. Pre-existing app behaviour, out of this
  // story's scope to change; autocomplete is a stable, unambiguous anchor.
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Pipeline" }).click();

  const board = page.locator('[data-tour="pipeline-board"]');
  await expect(board).toBeVisible();
  await expect(board.getByText("New", { exact: true })).toBeVisible();
});

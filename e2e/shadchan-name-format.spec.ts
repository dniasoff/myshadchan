import { expect, test } from "./fixtures";

/**
 * Ronit's Shadchan create flow: the name field is ready for typing, lower-case
 * word initials are capitalised, and the saved record appears in the book.
 * Playwright runs this spec in both configured projects: Desktop Chrome and
 * Mobile Chrome (Pixel 5).
 */
test("creates a formatted shadchan name from the focused field", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Rivka",
    last_name: "E2E",
    email: `e2e-shadchan-name-format-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya E2E" });

  await signIn(page, member.email!);
  await page.getByRole("link", { name: "Shadchanim" }).click();
  await page
    .getByRole("toolbar", { name: "Entity list actions" })
    .getByRole("link", { name: "Add a shadchan" })
    .click();

  const nameInput = page.getByLabel("Name");
  await expect(nameInput).toBeFocused();

  await nameInput.fill("rivka cohen");
  await expect(nameInput).toHaveValue("Rivka Cohen");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Rivka Cohen", { exact: true })).toBeVisible();
});

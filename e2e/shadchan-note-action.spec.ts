import { expect, test, APP_URL } from "./fixtures";

/**
 * The configured Desktop Chrome and Mobile Chrome projects both run this
 * scenario. It verifies the real Notes tab -> Shadchanim list path, using the
 * accessible names exposed by the rendered controls rather than CSS details.
 */
test("shows a Note action only for a noted shadchan and opens it without navigation", async ({
  page,
  createMember,
  createSingle,
  createShadchan,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Notes",
    email: `e2e-shadchan-note-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });
  const notedShadchan = await createShadchan({
    accountId: single.account_id as number,
    name: "Rivka Note",
  });
  await createShadchan({
    accountId: single.account_id as number,
    name: "Moshe No Note",
  });

  await signIn(page, member.email!);
  await page.getByRole("link", { name: "Shadchanim" }).click();
  await page.getByRole("link", { name: "Open Rivka Note file" }).click();

  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const noteBody = `A private note for ${notedShadchan.name}`;
  await page.getByRole("textbox", { name: "Add a note" }).fill(noteBody);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(noteBody, { exact: true })).toBeVisible();

  await page.goto(`${APP_URL}/#/shadchanim`);
  await expect(
    page.getByRole("button", { name: "Open note for Rivka Note" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open note for Moshe No Note" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Open note for Rivka Note" }).click();
  const dialog = page.getByRole("dialog", { name: "Rivka Note — note" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(noteBody, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "View all notes" }),
  ).toHaveAttribute(
    "href",
    new RegExp(`/shadchanim/${notedShadchan.id}/notes$`),
  );
  await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(noteBody)));
});

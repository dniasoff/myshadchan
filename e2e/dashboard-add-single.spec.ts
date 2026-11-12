import { expect, test, APP_URL } from "./fixtures";

test("the populated dashboard opens the existing add-single flow", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ronit",
    last_name: "Dashboard",
    email: `e2e-dashboard-add-single-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  const addSingle = page.getByRole("link", { name: "Add a single" });
  await expect(addSingle).toBeVisible();
  await expect(addSingle).toHaveAttribute("href", /singles\/new/);

  await addSingle.click();
  await expect(page).toHaveURL(/#\/singles\/new$/);
  await expect(
    page.getByRole("heading", { name: "Add a single" }),
  ).toBeVisible();
  await expect(page.getByLabel("Photo")).toHaveCount(0);

  for (const label of [
    "Community",
    "Kohen status",
    "Marital status",
    "Status",
  ]) {
    await expect(page.getByLabel(label)).toHaveCount(0);
  }
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByLabel("Last name")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Gender" })).toBeVisible();
  await expect(page.getByLabel("Date of birth")).toBeVisible();
  await expect(
    page.getByText(
      "You can update the name, gender, or date of birth later from Edit single.",
    ),
  ).toBeVisible();

  await page.goto(`${APP_URL}/#/singles/${single.id}/edit`);
  await expect(
    page.getByRole("heading", { name: "Edit single" }),
  ).toBeVisible();
  for (const label of ["Community", "Kohen status", "Marital status"]) {
    await expect(page.getByLabel(label)).toHaveCount(0);
  }
  await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
  await expect(
    page.getByText(
      "You can update the name, gender, or date of birth later from Edit single.",
    ),
  ).toHaveCount(0);
});

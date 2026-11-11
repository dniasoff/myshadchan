import { expect, test } from "./fixtures";

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
  await createSingle({ member, first_name_en: "Chaya" });

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
});

import { APP_URL, expect, test } from "./fixtures";

test("Add a suggestion exposes a mobile-friendly resume picker", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ronit",
    last_name: "E2E",
    email: `e2e-suggestion-resume-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya E2E" });
  await signIn(page, member.email!);

  await page.goto(`${APP_URL}/#/shidduchim/new`);

  await expect(
    page.getByRole("heading", { name: "Add a suggestion" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Attach resume" }),
  ).toBeVisible();
  await expect(
    page.getByText("PDF, Word, JPG, PNG, HEIC, HEIF, or WebP · 8 MB maximum"),
  ).toBeVisible();

  await page.getByLabel("Attach resume").setInputFiles({
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a resume"),
  });

  await expect(
    page.getByText(
      "Please choose a PDF, Word document, JPG, PNG, HEIC, HEIF, or WebP file.",
    ),
  ).toBeVisible();
});

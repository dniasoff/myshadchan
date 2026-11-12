import { APP_URL, expect, test } from "./fixtures";

test("Add a suggestion exposes a mobile-friendly resume picker", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  await page.setViewportSize({ width: 393, height: 851 });
  let releaseParse!: () => void;
  const parseResponse = new Promise<void>((resolve) => {
    releaseParse = resolve;
  });
  await page.route("**/parse", async (route) => {
    await parseResponse;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          fields: {
            name_en: "Leah Original",
            name_he: null,
            father_en: null,
            father_he: null,
            mother_en: null,
            mother_he: null,
            seminary_en: "Bais Yaakov",
            seminary_he: null,
            shul_en: null,
            shul_he: null,
            location_en: "Lakewood",
            location_he: null,
            age: 24,
            height: "5'6\"",
            person_gender: null,
            kohen_status: null,
            marital_status: null,
          },
          lowConfidenceFields: ["age"],
          sections: { learningHistory: [], references: [] },
          rawDraft: { name_en: { value: "Leah Original", confidence: 0.95 } },
        },
      }),
    });
  });
  await page.route("**/rest/v1/rpc/ai_entitlement", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_entitled: true,
        plan: "ai",
        status: "active",
        resumes_used: 0,
        resumes_limit: 50,
      }),
    });
  });

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

  await page.getByLabel("Attach resume").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nresume fixture without personal data\n"),
  });
  await expect(page.getByText("Reading your resume…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Attach resume" }),
  ).toBeDisabled();
  await page.getByLabel("Name (English)").fill("Leah Edited");
  releaseParse();
  await expect(page.getByLabel("Name (English)")).toHaveValue("Leah Edited");
  await expect(page.getByLabel("Seminary (English)")).toHaveValue(
    "Bais Yaakov",
  );

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/rest/v1/shidduchim"),
  );
  await page.getByRole("button", { name: "Add a suggestion" }).click();
  const created = (await (await createResponse).json())[0];
  await expect(page).toHaveURL(/#\/shidduchim$/);
  await expect(page.getByText("Leah Edited")).toBeVisible();

  await page.goto(`${APP_URL}/#/shidduchim/${created.id}/resume`);
  await expect(page.getByText("resume.pdf")).toBeVisible();
});

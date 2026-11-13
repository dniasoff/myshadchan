import { APP_URL, expect, test } from "./fixtures";

test("Add a suggestion exposes a mobile-friendly resume picker", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const isMobileProject = test
    .info()
    .project.name.toLowerCase()
    .includes("mobile");
  await page.setViewportSize(
    isMobileProject
      ? { width: 375, height: 851 }
      : { width: 1440, height: 900 },
  );
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
          sections: {
            learningHistory: [
              {
                label: "Yeshiva",
                value: "Torah learning at Yeshivat Or HaChaim",
              },
            ],
            references: [
              { name: "Miriam E2E", relationship: "Teacher", phone: "" },
            ],
          },
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
    page.getByRole("button", { name: "Attach a resume" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "PDF, Word (.docx or .doc), JPG, PNG, HEIC or WebP · up to 8 MB. We keep the original file.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Photo (optional)" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Add a photo of the person being suggested. JPG, PNG, HEIC or WebP · up to 8 MB.",
    ),
  ).toBeVisible();

  await page.getByLabel("Attach resume").setInputFiles({
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a resume"),
  });
  await expect(
    page.getByText(
      "This file type is not supported here. Choose a .docx, PDF, JPG, PNG, HEIC or WebP file.",
    ),
  ).toBeVisible();

  await page.getByLabel("Attach resume").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nresume fixture without personal data\n"),
  });
  await expect(page.getByText("Reading your resume…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replace file" }),
  ).toBeDisabled();
  await page.getByLabel("Name (English)").fill("Leah Edited");
  releaseParse();
  await expect(page.getByLabel("Seminary (English)")).toHaveValue(
    "Bais Yaakov",
  );
  await expect(
    page.getByText(
      "We found a few details, but not everything. Please check the filled fields and add anything missing.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Name (English)")).toHaveValue("Leah Edited");

  await page.getByLabel("Upload a photo").setInputFiles({
    name: "suggested-person.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("photo fixture"),
  });
  await expect(page.getByText("Photo ready to add.")).toBeVisible();
  await expect(
    page.getByText("suggested-person.jpg", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Shared" })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Remove photo" }),
  ).toBeVisible();

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/rest/v1/rpc/create_shidduch"),
  );
  const photoResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/rest/v1/rpc/add_resume_photo"),
  );
  await page.getByRole("button", { name: "Add a suggestion" }).click();
  const created = (await (await createResponse).json())[0];
  const photoRpcResponse = await photoResponse;
  expect(photoRpcResponse.status()).toBe(200);
  expect(photoRpcResponse.ok()).toBeTruthy();
  const photoPayload = await photoRpcResponse.json();
  const photoRow = Array.isArray(photoPayload) ? photoPayload[0] : photoPayload;
  expect(photoRow.visibility).toBe("shared");
  await expect(page).toHaveURL(/#\/shidduchim$/);
  await expect(page.getByText("Leah Edited")).toBeVisible();

  await page.goto(`${APP_URL}/#/shidduchim/${created.id}/resume`);
  await expect(page.getByText("resume.pdf")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Original resume" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Easy-to-read resume" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Learning history" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "References" })).toBeVisible();
  await expect(page.getByText("Miriam E2E")).toBeVisible();
  await expect(page.getByText("No phone number saved")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Answered", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const browserGlobal = globalThis as typeof globalThis & {
        document: { documentElement: { scrollWidth: number } };
      };
      return browserGlobal.document.documentElement.scrollWidth;
    }),
  ).toBeLessThanOrEqual(isMobileProject ? 375 : 1440);
});

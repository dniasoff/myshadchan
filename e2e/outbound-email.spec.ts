import { APP_URL, expect, test } from "./fixtures";

test("server email sends the selected files through the authenticated worker", async ({
  page,
  createMember,
  createSingle,
  createShadchan,
  signIn,
}) => {
  // The e2e Vite server can spend several seconds compiling the first route;
  // keep the locator timeout above that cold-start cost while retaining the
  // fixture's real accessible-name locators.
  page.setDefaultTimeout(15000);
  const member = await createMember({
    first_name: "Ronit",
    last_name: "Email",
    email: `e2e-outbound-email-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });
  const shadchanContactField = "con" + "tacts";
  await createShadchan({
    accountId: single.account_id as number,
    name: "Aunty Ronit",
    [shadchanContactField]: { email: "ronit@example.test" },
  });

  await page.route("**/rest/v1/resumes**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      headers: {
        "content-range": "0-0/1",
        "access-control-expose-headers": "Content-Range",
      },
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 3301,
          account_id: single.account_id,
          single_id: single.id,
          files: [
            {
              path: `1/resumes/single-${single.id}/resume.pdf`,
              filename: "Chaya-resume.pdf",
              uploaded_at: "2026-11-01T00:00:00Z",
              uploaded_by: null,
              mime_type: "application/pdf",
              size: 12,
            },
          ],
          created_at: "2026-11-01T00:00:00Z",
        },
      ]),
    });
  });
  await page.route("**/rest/v1/resume_photos**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      headers: {
        "content-range": "0-0/1",
        "access-control-expose-headers": "Content-Range",
      },
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 4401,
          account_id: single.account_id,
          resume_id: 3301,
          path: `1/photos/shared/single-${single.id}/photo.jpg`,
          uploaded_at: "2026-11-01T00:00:00Z",
          visibility: "shared",
          hidden_at: null,
        },
      ]),
    });
  });

  const emailWorkerBodies: unknown[] = [];
  await page.route("http://localhost:8791/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { reply_to: "reply@example.test" },
        }),
      });
      return;
    }
    if (pathname === "/send") {
      emailWorkerBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { status: "accepted" } }),
      });
      return;
    }
    await route.continue();
  });

  await signIn(page, member.email!);
  await page.goto(`${APP_URL}/#/`);

  await page.getByRole("button", { name: "Send resume and photo" }).click();
  await expect(
    page.getByRole("heading", { name: "Send files to a shadchan" }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Shadchan" }).click();
  await page.getByRole("option", { name: "Aunty Ronit" }).click();

  const emailOption = page.getByRole("radio", {
    name: "Email from MyShadchan (attached automatically)",
  });
  await expect(emailOption).toBeEnabled();
  await emailOption.click();
  const sendButton = page.getByRole("button", {
    name: "Send resume and photo by email",
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    page.getByText(
      "Email accepted by the email service. MyShadchan can’t confirm delivery.",
    ),
  ).toBeVisible();
  await expect(sendButton).toBeDisabled();
  expect(emailWorkerBodies).toEqual([
    {
      single_id: single.id,
      shadchan_id: expect.any(Number),
      include_photo: true,
      request_id: expect.any(String),
    },
  ]);
});

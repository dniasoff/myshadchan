import { APP_URL, expect, test } from "./fixtures";

test("the shidduch rail exposes an accessible Print action on desktop and phone", async ({
  page,
  createMember,
  createSingle,
  createShidduch,
  signIn,
}) => {
  const isMobile = test.info().project.name === "Mobile Chrome";
  await page.setViewportSize(
    isMobile ? { width: 375, height: 851 } : { width: 1440, height: 900 },
  );

  const member = await createMember({
    first_name: "Ronit",
    last_name: "Print",
    email: `e2e-shidduch-print-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya Print" });
  const shidduch = await createShidduch({
    accountId: single.account_id,
    singleId: single.id,
    nameEn: "Yanky Print",
  });

  await signIn(page, member.email!);
  await page.goto(`${APP_URL}/#/shidduchim/${shidduch.id}/overview`);

  const forward = page.getByRole("button", {
    name: "Forward resume",
    exact: true,
  });
  const print = page.getByRole("button", { name: "Print", exact: true });
  await expect(forward).toBeVisible();
  await expect(print).toBeVisible();
  await expect(print).toBeDisabled();
  await expect(page.getByText("No resume available to print.")).toBeVisible();

  if (!isMobile) {
    const forwardBox = await forward.boundingBox();
    const printBox = await print.boundingBox();
    expect(forwardBox).not.toBeNull();
    expect(printBox).not.toBeNull();
    expect(Math.abs(forwardBox!.y - printBox!.y)).toBeLessThan(4);
  }

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: (
      globalThis as unknown as {
        document: { documentElement: { scrollWidth: number } };
      }
    ).document.documentElement.scrollWidth,
    innerWidth: (globalThis as unknown as { innerWidth: number }).innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test("prints the resume and only the eligible shared picture", async ({
  page,
  createMember,
  createSingle,
  createShidduch,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ronit",
    last_name: "Print bytes",
    email: `e2e-shidduch-print-bytes-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya Bytes" });
  const shidduch = await createShidduch({
    accountId: single.account_id,
    singleId: single.id,
    nameEn: "Yanky Bytes",
  });

  await signIn(page, member.email!);
  const resume = {
    id: 101,
    account_id: single.account_id,
    shidduchim_id: shidduch.id,
    files: [
      {
        path: `${single.account_id}/resumes/${shidduch.id}/resume.png`,
        filename: "resume.png",
        uploaded_at: "2026-01-01T00:00:00Z",
        uploaded_by: 1,
        mime_type: "image/png",
        size: 68,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
  };
  await page.route("**/rest/v1/resumes**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": "0-0/1",
        "access-control-expose-headers": "Content-Range",
      },
      body: JSON.stringify([resume]),
    }),
  );
  await page.route("**/rest/v1/resume_photos**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": "0-1/2",
        "access-control-expose-headers": "Content-Range",
      },
      body: JSON.stringify([
        {
          id: 201,
          account_id: single.account_id,
          resume_id: 101,
          path: `${single.account_id}/photos/shared/${shidduch.id}/photo.jpg`,
          uploaded_at: "2026-02-01T00:00:00Z",
          visibility: "shared",
          hidden_at: null,
        },
        {
          id: 202,
          account_id: single.account_id,
          resume_id: 101,
          path: `${single.account_id}/photos/shared/${shidduch.id}/private.jpg`,
          uploaded_at: "2026-03-01T00:00:00Z",
          visibility: "private_parent",
          hidden_at: null,
        },
      ]),
    }),
  );

  let signedFile = 0;
  await page.route("**/storage/v1/object/sign/**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    signedFile += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        signedURL: signedFile === 1 ? "/e2e-resume.png" : "/e2e-photo.jpg",
      }),
    });
  });
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/e2e-resume.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: imageBytes }),
  );
  await page.route("**/e2e-photo.jpg", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: imageBytes }),
  );
  await page.context().addInitScript(() => {
    (globalThis as unknown as { print: () => void }).print = () => {};
  });
  await page.goto(`${APP_URL}/#/shidduchim/${shidduch.id}/overview`);
  await expect(
    page.getByRole("checkbox", { name: "Include picture" }),
  ).toBeChecked();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('img[alt="resume.png"]')).toHaveCount(1);
  await expect(popup.locator('img[alt="photo.jpg"]')).toHaveCount(1);
  await expect(popup.locator('img[alt="private.jpg"]')).toHaveCount(0);
  await popup.close();
});

import { APP_URL, expect, test } from "./fixtures";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("enlarges an already-rendered suggestion preview on desktop and phone", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const isMobile = test.info().project.name === "Mobile Chrome";
  await page.setViewportSize(
    isMobile ? { width: 375, height: 851 } : { width: 1440, height: 900 },
  );

  const member = await createMember({
    first_name: "Ronit",
    last_name: "Photo",
    email: `e2e-photo-enlarge-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya Photo" });
  await signIn(page, member.email!);
  await page.goto(`${APP_URL}/#/shidduchim/new`);

  await page.getByLabel("Upload a photo").setInputFiles({
    name: "suggested-person.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });

  const enlarge = page.getByRole("button", {
    name: "Enlarge photo",
    exact: true,
  });
  await expect(enlarge).toBeVisible();
  await enlarge.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Enlarged photo" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close photo viewer", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Photo" })).toBeVisible();

  if (!isMobile) {
    const imageBox = await dialog
      .getByRole("img", { name: "Photo" })
      .boundingBox();
    expect(imageBox?.width ?? 0).toBeGreaterThan(600);
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: (
      globalThis as unknown as {
        document: { documentElement: { scrollWidth: number } };
      }
    ).document.documentElement.scrollWidth,
    innerWidth: (globalThis as unknown as { innerWidth: number }).innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

  await dialog
    .getByRole("button", { name: "Close photo viewer", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

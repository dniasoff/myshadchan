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

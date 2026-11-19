import { APP_URL, expect, test } from "./fixtures";

test.describe("Resume file delete ownership", () => {
  test("two pages without Web Locks finalize one opaque token harmlessly", async ({
    page,
    createMember,
    createSingle,
    createShidduch,
    createResume,
    signIn,
  }) => {
    test.setTimeout(35_000);

    const member = await createMember({
      first_name: "Ronit",
      last_name: "Delete",
      email: `e2e-resume-delete-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Chaya" });
    const shidduch = await createShidduch({
      accountId: single.account_id,
      singleId: single.id,
      nameEn: "Resume delete fixture",
    });
    await createResume({
      accountId: single.account_id,
      shidduchId: shidduch.id,
    });

    await signIn(page, member.email!);
    const pageB = await page.context().newPage();

    // Force the same fallback used by older Safari/WebViews only after the
    // auth shell has booted. Supabase Auth may use Web Locks during startup;
    // hiding it before sign-in strands both pages on the Suspense loader and
    // never exercises the resume-file fallback.
    for (const tab of [page, pageB]) {
      await tab.evaluate(() => {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: undefined,
        });
      });
    }

    const deleteRequests = { count: 0 };
    for (const tab of [page, pageB]) {
      tab.on("request", (request) => {
        if (request.url().includes("/rest/v1/rpc/remove_resume_file")) {
          deleteRequests.count += 1;
        }
      });
    }

    try {
      const resumeUrl = `${APP_URL}/#/shidduchim/${shidduch.id}/resume`;
      await page.goto(resumeUrl);
      await pageB.goto(resumeUrl);
      await expect(page.getByText("resume.pdf", { exact: true })).toBeVisible();
      await expect(
        pageB.getByText("resume.pdf", { exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Delete resume.pdf" }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();

      // The storage event hides the row in the second page before either
      // page's ten-second finalization timer fires.
      await expect(
        pageB.getByRole("button", { name: "Delete resume.pdf" }),
      ).toHaveCount(0);
      await expect(page.getByText("Deleted.")).toBeVisible();

      // The server-side opaque token makes a second page's delayed call
      // idempotent; both pages must settle on the removed state.
      await expect(page.getByText("Original resume · Removed")).toBeVisible({
        timeout: 20_000,
      });
      await pageB.reload();
      await expect(pageB.getByText("Original resume · Removed")).toBeVisible();
      expect(deleteRequests.count).toBeGreaterThanOrEqual(1);
      expect(deleteRequests.count).toBeLessThanOrEqual(2);
    } finally {
      await pageB.close();
    }
  });
});

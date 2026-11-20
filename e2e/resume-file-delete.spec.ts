import { createClient } from "@supabase/supabase-js";

import { APP_URL, expect, test } from "./fixtures";
import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

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
    const resume = await createResume({
      accountId: single.account_id,
      shidduchId: shidduch.id,
    });

    await signIn(page, member.email!);
    const pageB = await page.context().newPage();
    await pageB.goto(`${APP_URL}/#/shidduchim`);
    await expect(pageB.getByRole("link", { name: "Shidduchim" })).toBeVisible();

    // Both pages have now booted the authenticated shell while Web Locks are
    // available. Force the fallback only before either Original resume-tab
    // navigation;
    // hiding locks during auth startup strands a page on the Suspense loader.
    for (const tab of [page, pageB]) {
      await tab.evaluate(() => {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: undefined,
        });
      });
      expect(
        await tab.evaluate(
          () => (navigator as Navigator & { locks?: unknown }).locks,
        ),
      ).toBeUndefined();
    }

    const deleteRequests = { pageA: 0, pageB: 0 };
    page.on("request", (request) => {
      if (request.url().includes("/rest/v1/rpc/remove_resume_file")) {
        deleteRequests.pageA += 1;
      }
    });
    pageB.on("request", (request) => {
      if (request.url().includes("/rest/v1/rpc/remove_resume_file")) {
        deleteRequests.pageB += 1;
      }
    });

    try {
      // Original-file rows and their Delete action live on the full-page
      // Original resume tab; keep both pages on that tab for this Web Locks
      // test.
      const resumeUrl = `${APP_URL}/#/shidduchim/${shidduch.id}/original-resume`;
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

      // The resume row proves that the one fixture file was removed. The
      // storage object is intentionally absent, so successful purge draining
      // acknowledges and removes the queue row before this assertion.
      await expect
        .poll(
          async () => {
            const { data, error } = await adminSupabase
              .from("resumes")
              .select("files")
              .eq("id", resume.id)
              .single();
            if (error) throw error;
            return data?.files ?? null;
          },
          { timeout: 20_000 },
        )
        .toEqual([]);

      const { data: purgeRows, error: purgeError } = await adminSupabase
        .from("storage_purge_queue")
        .select("id")
        .eq("account_id", single.account_id)
        .eq("resume_id", resume.id)
        .eq("bucket", "documents")
        .eq("storage_path", resume.files[0].path);
      expect(purgeError).toBeNull();
      expect(purgeRows).toHaveLength(0);

      await page.reload();
      await expect(page.getByText("Original resume · Removed")).toBeVisible();
      await pageB.reload();
      await expect(pageB.getByText("Original resume · Removed")).toBeVisible();
      // The exact request count proves that only one page owned finalization;
      // the durable resume assertion above proves that it had the effect.
      expect(deleteRequests.pageA + deleteRequests.pageB).toBe(1);
    } finally {
      await pageB.close();
    }
  });
});

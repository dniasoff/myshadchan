import { APP_URL, expect, test } from "./fixtures";

test("email handoff is visibly unavailable while the feature flag is off", async ({
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

  let emailWorkerCalls = 0;
  // `.env.e2e` sets the same worker URL consumed by
  // `emailWorkerClient.ts`; this exact predicate proves the disabled path
  // never attempts the POST.
  await page.route("http://localhost:8791/send", async (route) => {
    emailWorkerCalls += 1;
    await route.abort();
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
  await expect(emailOption).toBeDisabled();
  await expect(
    page.getByText("Email sending is temporarily unavailable."),
  ).toBeVisible();
  await expect(emailWorkerCalls).toBe(0);
});

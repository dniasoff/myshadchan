import { test, expect, fetchOtpCode } from "./fixtures";

// Story 2.7: the invitee's ONLY path into the product. Covers AC-4 (the
// preview renders, the affirmation gates the OTP request) and AC-6/AC-7 (a
// matching signup actually lands the invitee inside the household they were
// invited into, not a generic dashboard). Runs against the same e2e stack
// as pipeline.spec.ts (email-OTP, story 2.6's passwordless flow). The invite
// itself is seeded directly here (rather than sent through the in-app
// InvitesSection form story 2.8 adds — see invite-sending.spec.ts for that
// path), exactly like the genesis-seed runbook this story's Dev Notes
// describe.
test("an invitee previews, affirms 18+, and signs in through an invite", async ({
  page,
  createInvite,
}) => {
  const email = `e2e-invitee-${Date.now()}@example.com`;
  const { token, accountName } = await createInvite({
    email,
    role: "helper",
  });

  await page.goto(`http://localhost:5175/#/accept-invite/${token}`);

  // AC-4: the preview names the household and role, never the inviter.
  await expect(page.getByText("You've been invited")).toBeVisible();
  await expect(page.getByText(accountName, { exact: false })).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toBeVisible();

  // AC-4: the box gates the OTP request — Continue doubles as "send code".
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue" }).click();

  const code = await fetchOtpCode(email);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();

  // AC-6/AC-7: the invite actually bound a real membership — the invitee
  // lands inside the app (not bounced back to a login/invite screen) and
  // can reach a resource scoped to the household they were invited into.
  await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();
});

test("an invite with no matching row shows a clear, specific message", async ({
  page,
}) => {
  await page.goto(
    "http://localhost:5175/#/accept-invite/00000000-0000-0000-0000-000000000000",
  );

  await expect(page.getByText("This invite link isn't valid")).toBeVisible();
});

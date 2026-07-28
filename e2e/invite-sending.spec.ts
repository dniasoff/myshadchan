import { test, expect } from "./fixtures";

// Story 2.8: the inviter-side UI review finding #3 flagged as missing
// coverage — a send form, a copyable link and a revoke action, none of
// which invite-acceptance.spec.ts (story 2.7) exercises, since that spec
// seeds its invite directly rather than sending one through the UI. Covers
// AC-1 (the one screen sends an invite), AC-2 (the link is shown, not
// emailed) and AC-3 (revoke flips status and the button disappears).
test("a parent_admin sends an invite from Settings, sees the link, then revokes it", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Rivka",
    last_name: "Shadchan",
    email: `e2e-inviter-${Date.now()}@example.com`,
  });
  // createSingle() provisions the household + parent_admin membership this
  // caller needs to be invite-capable (Settings' InvitesSection form is
  // hidden entirely for a non-invite-capable role — see the component's own
  // AC-1 note).
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  await page.goto("http://localhost:5175/#/settings");

  const inviteEmail = `e2e-invitee-${Date.now()}@example.com`;
  await page.locator("#invite-email").fill(inviteEmail);

  // AC-1: role selector, scoped to the caller's own authority — pick
  // "Helper" explicitly rather than relying on the default option.
  await page.locator("#invite-role").click();
  await page.getByRole("option", { name: "Helper" }).click();

  await page.getByRole("button", { name: "Send invite" }).click();

  // AC-2: the invite link is shown inline (shareable, not auto-emailed).
  const linkField = page.locator("input[readonly]");
  await expect(linkField).toBeVisible();
  await expect(linkField).toHaveValue(/\/#\/accept-invite\//);

  // AC-4: the new invite shows up in the list as pending, with a Revoke
  // action next to it (AC-3).
  await expect(page.getByText(inviteEmail)).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  const revokeButton = page.getByRole("button", { name: "Revoke" });
  await expect(revokeButton).toBeVisible();

  await revokeButton.click();

  // AC-3: revoking flips the status and the action disappears — a revoked
  // invite can never be revoked again.
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(revokeButton).not.toBeVisible();
});

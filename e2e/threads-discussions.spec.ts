import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 7.1 — open a shidduch's Discussions tab, start a discussion, post a
 * message, and read it back. Driven through the real app (not a mock): what
 * this proves that no unit test can is that `create_thread()` and the
 * participant-gated `messages` INSERT actually round-trip through Postgres
 * RLS for a real, signed-in session, and that the tab is reachable at
 * `/shidduchim/{id}/discussions` (Entity360's generic route, per this
 * story's "no bespoke tab shell" ruling).
 */

test("a parent_admin opens Discussions on a shidduch, starts a discussion, and posts a message", async ({
  page,
  createMember,
  createSingle,
  createShidduch,
  signIn,
}) => {
  // Arrange
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-thread-discuss-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });
  const shidduch = await createShidduch({
    accountId: single.account_id,
    singleId: single.id,
    nameEn: "Yanky Klein",
  });

  await signIn(page, member.email!);
  await page.goto(`${APP_URL}/#/shidduchim/${shidduch.id}/discussions`);

  // Act — open by default: no discussion exists yet.
  await expect(page.getByText("No discussions yet.")).toBeVisible();
  await page.getByRole("button", { name: "Start a discussion" }).click();

  // Assert — the new (empty) thread's panel mounts immediately.
  await expect(page.getByText("No messages yet.")).toBeVisible();

  // Act — post a message as the thread's own creator (a listed participant
  // from the moment create_thread() ran, AC-2).
  const messageText = `Any updates on ${single.first_name_en}'s resume?`;
  await page.getByPlaceholder("Write a message…").fill(messageText);
  await page.getByRole("button", { name: "Send" }).click();

  // Assert — the message reads back without a page reload.
  //
  // Scoped to the messages list, not the page: the discussion list beside it
  // now titles each row with that thread's last message, so an unscoped
  // getByText for the message body legitimately matches twice. Asserting
  // BOTH places is the stronger test — it pins that the message posted AND
  // that the list row it belongs to reflects it.
  const messages = page.getByRole("list", { name: "Messages" });
  const discussions = page.getByRole("list", { name: "Discussions" });
  await expect(messages.getByText(messageText)).toBeVisible();
  await expect(discussions.getByText(messageText)).toBeVisible();

  // Reload to prove the message and thread both actually persisted server-
  // side (RLS-readable on a fresh fetch), not merely held in client state.
  await page.reload();
  await expect(messages.getByText(messageText)).toBeVisible();
  await expect(discussions.getByText(messageText)).toBeVisible();
});

import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 12.3 — the whole point of family-shared tasks: two parents in one
 * household must see each other's work (AC-1) and be able to tell whose
 * task is whose (AC-3), with the Everyone/Assigned-to-me toggle actually
 * narrowing the list (AC-2). A component test with a mocked data provider
 * cannot prove the two-login path — this drives two REAL signed-in
 * sessions (a fresh, isolated browser context per login, since there is no
 * sign-out affordance to drive instead) through Postgres RLS and the new
 * `validate_task_assignee` trigger.
 *
 * The reminder-create sheet is the entry point (not `/tasks`, which has no
 * create control — `root/routeManifest.ts`'s own `tasks` exemption note),
 * with "Shadchan" as the linked-to type — the simplest seedable target,
 * needing no shidduch.
 */

test("assigning a reminder to the other parent shows it under Everyone but not under Assigned to me, then under Mine once that parent signs in", async ({
  page,
  browser,
  createMember,
  createSingle,
  createShadchan,
  addHouseholdMember,
  signIn,
}) => {
  // Arrange — a household with two active parents, and something to link
  // the reminder to.
  const stamp = Date.now();
  const parentA = await createMember({
    first_name: "Chani",
    last_name: "Klein",
    email: `e2e-tasks-assignment-a-${stamp}@example.com`,
  });
  const single = await createSingle({
    member: parentA,
    first_name_en: "Rivky",
  });
  const parentB = await createMember({
    first_name: "Yaakov",
    last_name: "Klein",
    email: `e2e-tasks-assignment-b-${stamp}@example.com`,
  });
  await addHouseholdMember({ accountId: single.account_id, member: parentB });
  await createShadchan({ accountId: single.account_id, name: "Malka Levy" });

  const reminderText = `Call Malka about the redt ${stamp}`;

  // Act — parent A signs in and creates a reminder, explicitly assigning it
  // to parent B.
  await signIn(page, parentA.email!);
  await page.goto(`${APP_URL}/#/reminders`);
  await page.getByRole("button", { name: "Add a reminder" }).click();

  await page.getByLabel("Remind me to...").fill(reminderText);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await page.getByLabel("Due date").fill(tomorrow.toISOString().slice(0, 10));
  await page.getByLabel("Time").fill("10:00");

  await page.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: "Shadchan" }).click();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Malka Levy" }).click();

  // The assignee select defaults to "you" (parent A) — reassign to B.
  await page.getByRole("combobox").nth(2).click();
  await page
    .getByRole("option", { name: "Yaakov Klein · Parent / admin" })
    .click();

  await page.getByRole("button", { name: "Add reminder" }).click();

  // Assert — visible under Everyone (AC-1: the default scope).
  await expect(page.getByText(reminderText)).toBeVisible();

  // Assert — AC-2: "Assigned to me" narrows it away for parent A, since the
  // task belongs to parent B.
  await page.getByRole("button", { name: "Assigned to me" }).click();
  await expect(page.getByText(reminderText)).not.toBeVisible();

  // Assert — switching back to Everyone brings it back.
  await page.getByRole("button", { name: "Everyone" }).click();
  await expect(page.getByText(reminderText)).toBeVisible();

  // Act — parent B signs in, in a fresh, isolated browser context (no
  // sign-out affordance exists to drive on the same page).
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  try {
    await signIn(pageB, parentB.email!);
    await pageB.goto(`${APP_URL}/#/reminders`);

    // Assert — Everyone (the default for this fresh session/store) already
    // shows it.
    await expect(pageB.getByText(reminderText)).toBeVisible();

    // Assert — AC-2/AC-3: "Assigned to me" keeps it for parent B, the
    // actual assignee.
    await pageB.getByRole("button", { name: "Assigned to me" }).click();
    await expect(pageB.getByText(reminderText)).toBeVisible();
  } finally {
    await contextB.close();
  }
});

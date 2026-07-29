import { APP_URL, expect, test } from "./fixtures";

/**
 * Story 4.2 AC 3: the List/Cards choice is per-entity and durable —
 * switching one list's mode does not affect the other's, survives
 * navigating away and back, and survives a hard reload. Two different store
 * keys ("shadchanim.entityListViewMode" / "singles.entityListViewMode") are
 * what make the independence hold (`root/crmStore.ts`'s single "CRM"
 * localStorage namespace, keyed per resource) — this spec exercises the
 * real app end to end rather than asserting on the keys directly (that half
 * is `useEntityListViewMode.test.ts`'s job).
 */
test.describe("Entity list view-mode toggle — per-entity persistence across navigation and reload (AC 3)", () => {
  test("switching /shadchanim to List mode leaves /singles on Cards, and both survive navigation + a hard reload", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Ada",
      last_name: "Shadchan",
      email: `e2e-view-toggle-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Chaya" });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Rivka Stern",
    });

    await signIn(page, member.email!);

    // Arrange — the shadchan book starts in Cards mode (its deliberate
    // first-visit default; Dev Notes, "Why the default is Cards on both
    // lists").
    await page.goto(`${APP_URL}/#/shadchanim`);
    await expect(
      page.getByRole("button", { name: "Cards view" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Act — switch the shadchan book to List mode.
    await page.getByRole("button", { name: "List view" }).click();

    // Assert — the toggle itself reflects the switch (targeted by role +
    // accessible name, per the story's own convention).
    await expect(
      page.getByRole("button", { name: "List view" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Act — navigate to /singles.
    await page.goto(`${APP_URL}/#/singles`);

    // Assert — the singles roster is unaffected: a different resource, a
    // different store key, still its own Cards default.
    await expect(
      page.getByRole("button", { name: "Cards view" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Act — navigate back to /shadchanim.
    await page.goto(`${APP_URL}/#/shadchanim`);

    // Assert — still List; the choice was not reset by leaving the page.
    await expect(
      page.getByRole("button", { name: "List view" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Act — a hard reload.
    await page.reload();

    // Assert — the choice survives the reload (persisted in localStorage
    // via `useStore`/`root/crmStore.ts`, not component state).
    await expect(
      page.getByRole("button", { name: "List view" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

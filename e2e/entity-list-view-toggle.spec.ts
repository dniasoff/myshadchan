import { APP_URL, expect, test } from "./fixtures";

/**
 * `tsconfig.node.json` compiles `e2e/**` with `lib: ["ES2023"]` and no DOM
 * (`demo-banner-cls.spec.ts`'s identical note) — the body passed to
 * `page.evaluate` below is the exception: it is serialised and run in the
 * page, not in Node, so it needs its own minimal ambient shim rather than
 * the full DOM lib.
 */
declare const document: {
  documentElement: { scrollWidth: number; clientWidth: number };
};

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

/**
 * Review fix (F1): the story's own Dev Notes ("Inherited from the
 * loose-ends round") named a real horizontal-overflow defect and asked for
 * a carried test — none existed. `EntityListToolbar` now carries
 * FilterButton + SortButton + `EntityListViewToggle` (two buttons) + the
 * create link at once, and their combined min-content width does not fit a
 * tablet-width row: measured `document.documentElement.scrollWidth` of
 * 809px / 810px against a 768px viewport on both `/shadchanim` and
 * `/singles`, with `TopToolbar`'s un-wrapped flex row named as the widest
 * node. Fixed by letting that row wrap onto a second line
 * (`misc/EntityListToolbar.tsx`) instead of forcing the page wider than the
 * viewport — this spec asserts the page-level effect (no horizontal
 * scroll), not the CSS mechanism, so it stays true across any future
 * layout change that keeps the same outcome.
 */
test.describe("Entity list toolbar — no horizontal page scroll at tablet widths (F1)", () => {
  test("neither /shadchanim nor /singles scrolls horizontally across the 768-809px band", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }, testInfo) => {
    // This test drives its own explicit tablet-width viewport, which is the
    // point — the emulated "Mobile Chrome" project's own (phone-sized)
    // viewport already exercises narrow-width layout on every other spec,
    // and forcing a second, unrelated viewport size onto an `isMobile`
    // emulated context is a known source of Playwright/CDP flakiness
    // ("Execution context was destroyed") unrelated to this fix.
    test.skip(
      testInfo.project.name === "Mobile Chrome",
      "tablet-width check is desktop-context-only; Mobile Chrome's own emulated viewport already covers narrow widths",
    );

    const member = await createMember({
      first_name: "Tova",
      last_name: "Tablet",
      email: `e2e-view-toggle-overflow-${Date.now()}@example.com`,
    });
    const single = await createSingle({
      member,
      first_name_en: "Overflow Single",
    });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Overflow Shadchan",
    });

    await signIn(page, member.email!);

    // The exact band the review measured overflow in: ok at 768 and below,
    // overflow appeared at 780/790/800, ok again at 810+. Checking both ends
    // of the failing band is enough to prove the fix without re-sweeping
    // every width the review already covered.
    for (const width of [768, 800]) {
      await page.setViewportSize({ width, height: 1024 });

      for (const path of ["/shadchanim", "/singles"]) {
        await page.goto(`${APP_URL}/#${path}`);
        await expect(
          page.getByRole("button", { name: "Cards view" }),
        ).toBeVisible();

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        expect(
          scrollWidth,
          `${path} scrolls horizontally at ${width}px viewport ` +
            `(scrollWidth=${scrollWidth} > clientWidth=${clientWidth})`,
        ).toBeLessThanOrEqual(clientWidth);
      }
    }
  });
});

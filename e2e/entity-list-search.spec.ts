import { expect, test } from "./fixtures";

/**
 * Story 4.1 AC 5: all list state (search text, active filters, sort,
 * page/perPage) lives in the URL for every `EntityList`-backed list, and
 * survives a hard reload. Exercised on `/shadchanim` — one of the two
 * lists this story retrofits (`references` is excluded by RULING 7).
 */
test.describe("Entity list search survives a hard reload (AC 5) — /shadchanim", () => {
  test("search narrows the shadchan book, and both the search term and the filtered result persist across a reload", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Ada",
      last_name: "Shadchan",
      email: `e2e-entity-list-search-${Date.now()}@example.com`,
    });
    // createSingle also provisions the household account this member's two
    // shadchanim below attach to — reused via single.account_id rather than
    // provisioning a second account (e2e/fixtures.ts, createShadchan).
    const single = await createSingle({ member, first_name_en: "Chaya" });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Rivka Stern",
    });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Moshe Adler",
    });

    await signIn(page, member.email!);
    await page.getByRole("link", { name: "Shadchanim" }).click();

    await expect(page.getByText("Rivka Stern")).toBeVisible();
    await expect(page.getByText("Moshe Adler")).toBeVisible();

    // Act — search narrows the roster server-side against Supabase (AC 4).
    await page.getByPlaceholder("Search by name").fill("Rivka");

    // Assert — the filtered result, and the URL now holds the search term
    // (AC 5's "filter param is absent" failure mode).
    await expect(page.getByText("Rivka Stern")).toBeVisible();
    await expect(page.getByText("Moshe Adler")).not.toBeVisible();
    await expect(page).toHaveURL(/filter=.*Rivka/);

    // Act — a hard reload must restore the URL-held state, not reset to the
    // unfiltered roster (AC 5's other failure mode).
    await page.reload();

    // Assert
    await expect(page.getByPlaceholder("Search by name")).toHaveValue("Rivka");
    await expect(page.getByText("Rivka Stern")).toBeVisible();
    await expect(page.getByText("Moshe Adler")).not.toBeVisible();
  });

  // Review fix (F1): `applyFullTextSearch` (dataProvider.ts) builds
  // PostgREST's `or=(...)` logic-tree syntax from the raw search term. That
  // syntax is a comma-separated list with no escaping in this stack, so a
  // literal comma inside a search term used to land unescaped in the list
  // and PostgREST refused to parse it (`PGRST100`), 400ing the request
  // before RLS even ran — against the REAL local Supabase/PostgREST, not
  // FakeRest, which never had this failure mode. AC-4's own named failure
  // ("PostgREST answers 400") is exactly what this proves fixed.
  test("a comma in the search term does not 400 the list, and still finds the match", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Ada",
      last_name: "Shadchan",
      email: `e2e-entity-list-comma-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Chaya" });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Rivka Stern",
    });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Moshe Adler",
    });

    await signIn(page, member.email!);
    await page.getByRole("link", { name: "Shadchanim" }).click();

    await expect(page.getByText("Rivka Stern")).toBeVisible();
    await expect(page.getByText("Moshe Adler")).toBeVisible();

    // Act
    await page.getByPlaceholder("Search by name").fill("Stern, Rivka");

    // Assert — the matching shadchan is found (the request survived), never
    // EntityListView's generic error block.
    await expect(page.getByText("Rivka Stern")).toBeVisible();
    await expect(page.getByText("Moshe Adler")).not.toBeVisible();
    await expect(
      page.getByText("Something went wrong loading this list."),
    ).not.toBeVisible();
  });
});

/**
 * Story 4.1 AC 5 / AC 10 (review fix, F4): sort field/order is also
 * URL-held state and must survive a hard reload. `ShadchanList` gained
 * `sortFields={["name", "location"]}` as part of this fix — before it,
 * `EntityListToolbar`'s `SortButton` never rendered on either retrofitted
 * list, so this half of AC-5 had no reachable UI anywhere in the app.
 */
test.describe("Entity list sort survives a hard reload (AC 5, AC 10) — /shadchanim", () => {
  test("flipping the sort order re-sorts the shadchan book, and both the field and order persist across a reload", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Ada",
      last_name: "Shadchan",
      email: `e2e-entity-list-sort-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Chaya" });
    // Alphabetically well-separated names so ASC vs DESC order is unambiguous.
    await createShadchan({
      accountId: single.account_id as number,
      name: "Ariella Katz",
    });
    await createShadchan({
      accountId: single.account_id as number,
      name: "Zev Adler",
    });

    await signIn(page, member.email!);
    await page.getByRole("link", { name: "Shadchanim" }).click();

    // `[href$="/show"]` (not `[href*="/shadchanim/"]`, which also matches
    // the "Add a shadchan" CTA's `/shadchanim/new`) — each card is a
    // `RecordLink` to `buildRecordPath("shadchanim", id)` ==
    // `/shadchanim/{id}/show` (shadchanim/entityDescriptor.ts).
    const shadchanLinks = page.locator('a[href$="/show"]');
    await expect(shadchanLinks).toHaveCount(2);

    // The default sort is `{ field: "name", order: "ASC" }` — "Ariella"
    // leads.
    await expect(shadchanLinks.nth(0)).toContainText("Ariella Katz");
    await expect(shadchanLinks.nth(1)).toContainText("Zev Adler");

    // Act — open the sort menu and click the already-active "Name" field
    // again, which flips it from ASC to DESC (SortButton's own toggle rule).
    await page.getByRole("button", { name: /^Sort by/ }).click();
    await page.getByRole("menuitem", { name: /^Name/ }).click();

    // Assert — the book re-sorts, and the URL now holds the new order (AC
    // 5's "sort field/order held in the URL" failure mode).
    await expect(shadchanLinks.nth(0)).toContainText("Zev Adler");
    await expect(shadchanLinks.nth(1)).toContainText("Ariella Katz");
    await expect(page).toHaveURL(/sort=name/);
    await expect(page).toHaveURL(/order=DESC/);

    // Act — a hard reload must restore the URL-held sort, not reset to the
    // original ascending order.
    await page.reload();

    // Assert
    await expect(shadchanLinks.nth(0)).toContainText("Zev Adler");
    await expect(shadchanLinks.nth(1)).toContainText("Ariella Katz");
  });
});

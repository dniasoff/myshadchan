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
});

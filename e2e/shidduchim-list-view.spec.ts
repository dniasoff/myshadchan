import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { expect, test } from "./fixtures";

/**
 * Story 4.3, AC-1/AC-4: proves the board/list/cards switch is store-keyed
 * (never the URL) and that the selected single + search text are ONE shared
 * state across positions, surviving a hard reload.
 *
 * `e2e/fixtures.ts`'s `createSingle` always provisions a brand-new household
 * account, so it cannot put a SECOND single on the SAME account the way
 * `createShadchan` can (it takes an existing `accountId`). This spec's own
 * admin client mirrors that fixture's own service-role pattern for exactly
 * that one gap — a second single, and the shidduchim under each single —
 * rather than editing the shared fixtures file (Ownership hazards table:
 * `e2e/fixtures.ts` is not this story's to touch).
 */
const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function createSecondSingle({
  accountId,
  firstNameEn,
}: {
  accountId: number;
  firstNameEn: string;
}) {
  const { data, error } = await adminSupabase
    .from("singles")
    .insert({ account_id: accountId, first_name_en: firstNameEn })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create second single: ${error.message}`);
  }

  return data as { id: number; account_id: number };
}

/** Minimal, direct insert — the SPA's own AD-4 invariant 1 (create_shidduch
 * is the sole INSERT path) governs the app's own write surface, not this
 * service-role e2e seed, exactly like createShadchan's direct insert above. */
async function seedShidduch({
  accountId,
  singleId,
  nameEn,
}: {
  accountId: number;
  singleId: number;
  nameEn: string;
}) {
  const { error } = await adminSupabase
    .from("shidduchim")
    .insert({ account_id: accountId, single_id: singleId, name_en: nameEn });

  if (error) {
    throw new Error(`Failed to seed shidduch "${nameEn}": ${error.message}`);
  }
}

test("board, list and cards share filters and context, and both survive a reload (AC-1, AC-4)", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-shidduchim-list-view-${Date.now()}@example.com`,
  });
  const chaya = await createSingle({ member, first_name_en: "Chaya" });
  const rivka = await createSecondSingle({
    accountId: chaya.account_id as number,
    firstNameEn: "Rivka",
  });

  await seedShidduch({
    accountId: chaya.account_id as number,
    singleId: chaya.id as number,
    nameEn: "Ari Rosenberg",
  });
  await seedShidduch({
    accountId: chaya.account_id as number,
    singleId: chaya.id as number,
    nameEn: "Moshe Adler",
  });
  await seedShidduch({
    accountId: rivka.account_id,
    singleId: rivka.id,
    nameEn: "Dovid Katz",
  });

  await signIn(page, member.email!);
  await page.getByRole("link", { name: "Shidduchim" }).click();

  // Act — AC-1: switch to List. Only a `<section aria-label>` (List/Cards)
  // gets an implicit accessibility "region" role; the Board's own `<section>`
  // has no accessible name, so this discriminates List from Board.
  await page.getByRole("button", { name: "List view" }).click();

  // Assert
  await expect(page.getByRole("region", { name: "New" })).toBeVisible();
  await expect(page.getByText("Ari Rosenberg")).toBeVisible();
  await expect(page.getByText("Moshe Adler")).toBeVisible();

  // Act — AC-3: search filters server-side.
  await page.getByPlaceholder(/search/i).fill("Adler");

  // Assert
  await expect(page.getByText("Moshe Adler")).toBeVisible();
  await expect(page.getByText("Ari Rosenberg")).not.toBeVisible();

  // Act — AC-4: switching to the Board keeps the SAME filtered data — no
  // second fetch, no reset (AC-6).
  await page.getByRole("button", { name: "Board view" }).click();

  // Assert — the board's visible cards are filtered to the same term.
  await expect(page.getByText("Moshe Adler")).toBeVisible();
  await expect(page.getByText("Ari Rosenberg")).not.toBeVisible();

  // Act — clear the search, then switch to Rivka's pipeline via the pills.
  await page.getByPlaceholder(/search/i).fill("");
  await page.getByRole("button", { name: "Rivka" }).click();

  // Assert — AC-4: the selected single is shared state — Chaya's shidduchim
  // are gone, Rivka's are shown, on the SAME (Board) position.
  await expect(page.getByText("Dovid Katz")).toBeVisible();
  await expect(page.getByText("Moshe Adler")).not.toBeVisible();

  // Act — back to List, search Rivka's own pipeline, then hard-reload.
  await page.getByRole("button", { name: "List view" }).click();
  await page.getByPlaceholder(/search/i).fill("Katz");
  await expect(page.getByText("Dovid Katz")).toBeVisible();
  await expect(page).toHaveURL(/filter=.*Katz/);
  // Sanity: single_id is Rivka's real id, not the default (Chaya's) single.
  await expect(page).toHaveURL(new RegExp(`single_id.*${rivka.id}`));

  await page.reload();

  // Assert — AC-1/AC-4: the view (from the store), the search term and the
  // selected single (from the URL's `filter` param) are all restored.
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByPlaceholder(/search/i)).toHaveValue("Katz");
  await expect(page.getByText("Dovid Katz")).toBeVisible();
  await expect(page.getByText("Moshe Adler")).not.toBeVisible();
});

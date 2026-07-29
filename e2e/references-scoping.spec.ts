import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";

/**
 * RULING 7, driven through the real app.
 *
 * Two things are pinned here that no unit test can pin, because both are
 * properties of the ROUTER the app actually boots with (`ra-core`'s
 * `HashRouter`) and of the database row a save really produces:
 *
 *  1. The sanctioned "Add a reference" CTA works. It opens
 *     `#/references/new?shidduchim_id=N`, where the query string lives
 *     inside the hash — reading it off `window.location.search` (as the
 *     component did) resolved nothing, so the refusal panel fired for every
 *     user and there was no way to add a reference at all.
 *  2. The save produces a `reference_links` row. That is the orphan-
 *     prevention the refusal panel exists to protect; a reference with zero
 *     links is invisible in the shidduch it was created from.
 *
 * And one more, for the browse surface: `#/references` renders the
 * unattached-references index, not the reference book.
 */

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function seedShidduch({
  accountId,
  singleId,
  nameEn,
}: {
  accountId: number;
  singleId: number;
  nameEn: string;
}): Promise<number> {
  const { data, error } = await adminSupabase
    .from("shidduchim")
    .insert({ account_id: accountId, single_id: singleId, name_en: nameEn })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to seed shidduch "${nameEn}": ${error?.message}`);
  }

  return data.id as number;
}

test("adding a reference from a shidduch saves it AND links it to that shidduch", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-reference-create-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });
  const shidduchId = await seedShidduch({
    accountId: single.account_id,
    singleId: single.id,
    nameEn: "Yanky Klein",
  });

  await signIn(page, member.email!);
  await page.goto(`${APP_URL}/#/shidduchim/${shidduchId}/show`);

  // Act — the ONE sanctioned entry point (RULING 7 clause 5).
  await page.getByRole("link", { name: "Add a reference" }).click();

  // Assert — the form, not the "start from a shidduch" refusal. Under the
  // HashRouter the shidduchim_id is only reachable through the router's own
  // location, which is exactly what regressed.
  await expect(page).toHaveURL(
    new RegExp(`#/references/new\\?shidduchim_id=${shidduchId}$`),
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();

  // Act — save a genuinely new person.
  await page.getByLabel("Name", { exact: true }).fill("Mrs Devora Gold");
  await page.getByRole("button", { name: "Save" }).click();

  // Assert — landed on the reference's own record…
  await expect(page).toHaveURL(/#\/references\/\d+\/show$/);

  // …and the row is NOT an orphan: the link the shidduch reaches it through
  // exists in the database.
  const { data: reference } = await adminSupabase
    .from("references")
    .select("id")
    .eq("name_en", "Mrs Devora Gold")
    .single();
  expect(reference).not.toBeNull();

  const { data: links } = await adminSupabase
    .from("reference_links")
    .select("reference_id, shidduchim_id")
    .eq("reference_id", reference!.id);
  expect(links).toEqual([
    { reference_id: reference!.id, shidduchim_id: shidduchId },
  ]);

  // And it is visible from the shidduch it was created from.
  await page.goto(`${APP_URL}/#/shidduchim/${shidduchId}/show`);
  await expect(page.getByText("Mrs Devora Gold")).toBeVisible();
});

test("#/references is the unattached-references index, not the reference book", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange
  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-references-index-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  // Act
  await page.goto(`${APP_URL}/#/references`);

  // Assert — the index, and none of the book's browse affordances.
  await expect(
    page.getByRole("heading", { name: "Unattached references" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create" })).toHaveCount(0);
});

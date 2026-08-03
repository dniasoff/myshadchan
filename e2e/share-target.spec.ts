import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { APP_URL, expect, test } from "./fixtures";

/**
 * Story 10.1: the Web Share Target Level 2 landing screen. Playwright cannot
 * drive the real Android/OS share sheet, so the "a photo was shared" case is
 * simulated the way `src/sw.ts`'s own header describes the hand-off: a
 * `shareKey` is pre-seeded into the Cache API (exactly what the service
 * worker's `fetch` handler does for a real POSTed share), then `/#/share` is
 * loaded directly with that key in the query string — the same URL the
 * worker's `Response.redirect` produces.
 *
 * `tsconfig.node.json` compiles `e2e/**` with `lib: ["ES2023"]` and no DOM
 * (`pipeline.spec.ts`'s identical note) — the body passed to `page.evaluate`
 * below runs in the browser page, not in Node, so it needs its own minimal
 * ambient shim for the Cache API rather than the full DOM lib.
 */
declare const caches: {
  open(cacheName: string): Promise<{
    put(key: string, response: InstanceType<typeof Response>): Promise<void>;
  }>;
};
declare class Response {
  constructor(body: unknown);
}
declare class Blob {
  constructor(parts: unknown[], options?: { type?: string });
}

/**
 * `src/sw.ts` and `inbox/ShareTarget.tsx` each keep their own copy of these
 * three literals — a separate build (the service-worker bundle) cannot
 * import from the app bundle, per those files' own header comments. This
 * spec seeds the cache the same way the worker does, so it needs the same
 * literals a third time, here in Node-side test code. The leading "/" is
 * required — see `src/sw.ts`'s header comment for why a bare "<uuid>:…" key
 * fails against the real Cache API (reproduced by this very spec).
 */
const SHARE_TARGET_CACHE = "share-target-inbox";
const shareManifestKey = (shareKey: string) =>
  `/share-target-inbox/${shareKey}/manifest`;
const shareFileKey = (shareKey: string, index: number) =>
  `/share-target-inbox/${shareKey}/${index}`;

/** Seeds a fake shared photo into the Cache API on `page`'s current origin —
 * the Playwright-side stand-in for `src/sw.ts`'s `fetch` handler, which a
 * real Android share sheet triggers and this test environment cannot. */
async function seedSharedPhoto(page: Page, shareKey: string) {
  await page.evaluate(
    async ({ cacheName, manifestKey, fileKey, fileName, fileType }) => {
      const cache = await caches.open(cacheName);
      const manifest = [{ name: fileName, type: fileType }];
      await cache.put(manifestKey, new Response(JSON.stringify(manifest)));
      await cache.put(
        fileKey,
        new Response(new Blob(["fake-image-bytes"], { type: fileType })),
      );
    },
    {
      cacheName: SHARE_TARGET_CACHE,
      manifestKey: shareManifestKey(shareKey),
      fileKey: shareFileKey(shareKey, 0),
      fileName: "resume.jpg",
      fileType: "image/jpeg",
    },
  );
}

test.describe("Share-target completion (Story 10.1)", () => {
  test("a shared photo resolves into a new suggestion, with a shadchan credited (AC 1/2/3/4)", async ({
    page,
    createMember,
    createSingle,
    createShadchan,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Chana",
      last_name: "Household",
      email: `e2e-share-photo-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Malka E2E" });
    const shadchan = await createShadchan({
      accountId: single.account_id as number,
      name: "Devorah the Shadchan",
    });

    await signIn(page, member.email!);

    // AC 1: hand off a shared photo via the same Cache API round trip
    // `src/sw.ts` performs for a real share.
    const shareKey = randomUUID();
    await seedSharedPhoto(page, shareKey);

    await page.goto(`${APP_URL}/#/share?shareKey=${shareKey}`);

    await expect(
      page.getByRole("heading", { name: "File this share" }),
    ).toBeVisible();

    // AC 2: a shared photo defaults the source tab to "Photo".
    await expect(page.getByRole("tab", { name: "Photo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // AC 3: resolve the shadchan via the same typeahead ShidduchInputs uses.
    await page.getByRole("combobox", { name: "Shadchan" }).click();
    await page.getByRole("option", { name: shadchan.name as string }).click();

    // AC 4: a household with exactly one single needs no picker — nothing
    // to disambiguate, so no pill picker should render at all.
    await expect(page.getByText("Which single is this for?")).not.toBeVisible();

    await page.getByRole("button", { name: "Save & review" }).click();

    await expect(page).toHaveURL(/#\/inbox_items/);

    // The single household never disambiguated (AC 4) is still the one the
    // new suggestion was filed against — `ShidduchCard`/`ShidduchRow` fall
    // back to the single's own name when the suggestion itself has none yet.
    await page.goto(`${APP_URL}/#/shidduchim`);
    await expect(page.getByText("Malka E2E")).toBeVisible();
  });

  test("skip drops the capture, unresolved, in the Inbox (AC 6)", async ({
    page,
    createMember,
    createSingle,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Tzivia",
      last_name: "Household",
      email: `e2e-share-skip-${Date.now()}@example.com`,
    });
    await createSingle({ member, first_name_en: "Rochel E2E" });

    await signIn(page, member.email!);

    const rawText = "Some WhatsApp text about a suggestion";
    await page.goto(`${APP_URL}/#/share?text=${encodeURIComponent(rawText)}`);

    await expect(
      page.getByRole("heading", { name: "File this share" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Skip — drop it in my Inbox" })
      .click();

    await expect(page).toHaveURL(/#\/inbox_items/);
    await expect(page.getByText(rawText)).toBeVisible();
  });

  test("cross-account isolation: linking to an existing suggestion never surfaces another account's rows (AC 8)", async ({
    page,
    createMember,
    createSingle,
    createShidduch,
    signIn,
  }) => {
    const memberA = await createMember({
      first_name: "Leah",
      last_name: "HouseholdA",
      email: `e2e-share-a-${Date.now()}@example.com`,
    });
    const singleA = await createSingle({
      member: memberA,
      first_name_en: "Sara A",
    });
    // Review fix (F2, BLOCKING): a positive control on account A's OWN
    // suggestion, searched below BEFORE the cross-account check — without
    // it, this test only ever proved the search returns nothing, which is
    // exactly as true when the search is broken (returns nothing for
    // EVERY account, own included) as when it correctly excludes another
    // account. Proven live: mutating the search filter to always return no
    // rows left this test green with no such positive assertion present.
    //
    // Kept to two words: `applyFullTextSearch` + `@raphiniert/ra-data-
    // postgrest`'s `or=(...)` builder mis-serializes any ilike value of
    // THREE OR MORE words combined with multiple `@or` columns (confirmed
    // pre-existing on `main`, reproduced independently of this story) —
    // out of scope here; this fixture avoids it rather than exercising it.
    await createShidduch({
      accountId: singleA.account_id as number,
      singleId: singleA.id as number,
      nameEn: "Available Pick",
    });

    const memberB = await createMember({
      first_name: "Miriam",
      last_name: "HouseholdB",
      email: `e2e-share-b-${Date.now()}@example.com`,
    });
    const singleB = await createSingle({
      member: memberB,
      first_name_en: "Yael B",
    });
    await createShidduch({
      accountId: singleB.account_id as number,
      singleId: singleB.id as number,
      nameEn: "Confidential Choice",
    });

    await signIn(page, memberA.email!);

    await page.goto(
      `${APP_URL}/#/share?text=${encodeURIComponent("Some raw text")}`,
    );

    const searchBox = page.getByPlaceholder(
      "Or link to an existing suggestion…",
    );

    // Positive control: account A's own suggestion IS found.
    await searchBox.fill("Available Pick");
    await expect(page.getByText("Available Pick")).toBeVisible({
      timeout: 15000,
    });

    // Negative check: account B's suggestion is never surfaced, even though
    // the search mechanism is now proven to actually return rows. The names
    // deliberately share no words: the full-text hook ORs each word across
    // every column, so a shared word (e.g. "Match") would make account A's
    // own suggestion reappear and invalidate the negative assertion.
    await searchBox.fill("");
    await searchBox.fill("Confidential Choice");
    await expect(page.getByText("No matching suggestions.")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Confidential Choice")).toHaveCount(0);
  });

  test("linking to an existing suggestion attaches the capture without creating a duplicate, and Enter never submits the create-new form instead (AC 1/5/6/7)", async ({
    page,
    createMember,
    createSingle,
    createShidduch,
    signIn,
  }) => {
    const member = await createMember({
      first_name: "Shprintza",
      last_name: "Household",
      email: `e2e-share-link-${Date.now()}@example.com`,
    });
    const single = await createSingle({ member, first_name_en: "Bracha E2E" });
    // Two words only — see the cross-account test's comment above for why.
    const existing = await createShidduch({
      accountId: single.account_id as number,
      singleId: single.id as number,
      nameEn: "Existing Match",
    });

    await signIn(page, member.email!);

    // Deliberately does NOT contain "Existing Match" as a substring — the
    // raw-text preview panel renders this verbatim on the same screen as
    // the search results list, and a shared text that echoed the
    // suggestion's own name would make `getByText("Existing Match")` match
    // two elements (a Playwright strict-mode violation) instead of the one
    // search-result row these assertions mean to target.
    const sharedText = "Spoke with them again today";
    await page.goto(
      `${APP_URL}/#/share?text=${encodeURIComponent(sharedText)}`,
    );

    await expect(
      page.getByRole("heading", { name: "File this share" }),
    ).toBeVisible();

    const searchBox = page.getByPlaceholder(
      "Or link to an existing suggestion…",
    );
    await searchBox.fill("Existing Match");

    // Review fix (F2, BLOCKING): the positive control this search never
    // had — the row genuinely surfaces, not just "no test ever proved it
    // could".
    await expect(page.getByText("Existing Match")).toBeVisible({
      timeout: 15000,
    });

    // Review fix (F1, BLOCKING): this search box used to live inside the
    // same <Form> as the "create a NEW suggestion" fields, whose SaveButton
    // is type="submit" — pressing Enter here submitted THAT form instead of
    // doing nothing, creating a second, duplicate suggestion (AC 5
    // explicitly forbids this). A regression here would navigate straight
    // to /#/inbox_items, exactly as the real "Save & review" button does.
    await searchBox.press("Enter");
    await expect(page).toHaveURL(/#\/share/);
    await expect(
      page.getByRole("heading", { name: "File this share" }),
    ).toBeVisible();
    await expect(page.getByText("Existing Match")).toBeVisible();

    await page.getByRole("button", { name: "Link" }).click();

    await expect(page).toHaveURL(/#\/inbox_items/);

    // No duplicate suggestion exists — exactly one "Existing Match" row is
    // on the board (review fix F2: no test had ever actually clicked
    // "Link" before this one).
    await page.goto(`${APP_URL}/#/shidduchim`);
    await expect(page.getByText("Existing Match")).toHaveCount(1);

    // AC 7: the capture was attached as a note against the SAME suggestion
    // — never a bespoke insert — and shows up in its Notes tab
    // automatically, no new rendering path needed.
    await page.goto(`${APP_URL}/#/shidduchim/${existing.id}/notes`);
    await expect(page.getByText(sharedText)).toBeVisible();
  });
});

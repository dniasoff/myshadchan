import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect } from "./fixtures";

/** Same service-role pattern as `shidduchim-list-view.spec.ts`'s own admin
 * client — needed here only to seed one shidduch so the List position's
 * "New" region actually renders a section instead of AC-7's own
 * genuinely-empty EmptyState (a real single with zero shidduchim). */
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
}) {
  const { error } = await adminSupabase
    .from("shidduchim")
    .insert({ account_id: accountId, single_id: singleId, name_en: nameEn });

  if (error) {
    throw new Error(`Failed to seed shidduch "${nameEn}": ${error.message}`);
  }
}

/**
 * `tsconfig.node.json` compiles `e2e/**` with `lib: ["ES2023"]` and no DOM
 * (`entity-list-view-toggle.spec.ts`'s identical note) — the body passed to
 * `page.evaluate` below is the exception: it is serialised and run in the
 * page, not in Node, so it needs its own minimal ambient shim rather than
 * the full DOM lib.
 */
interface EvaluateElement {
  scrollWidth: number;
  clientWidth: number;
  tagName: string;
}
declare const document: {
  documentElement: { scrollWidth: number };
  getElementById: (id: string) => {
    querySelectorAll: (selector: string) => EvaluateElement[];
  } | null;
};

// The core sign-in-and-see-the-pipeline smoke spec (AC-14), split per
// position by project: chromium (desktop) asserts the Board — its own
// default view (AC-1) — and Mobile Chrome asserts the List position, which
// is ITS default. Sign-in itself waits on the "Shidduchim" nav link
// (relabelled from "Pipeline" by Story 4.4) — shared between the desktop
// Sidebar and the mobile bottom nav via the same PRIMARY_NAV list.

test("member signs in and sees the pipeline board (chromium)", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "the Board is chromium's (desktop) default view — see the Mobile Chrome test below for the List position",
  );

  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-pipeline-board-${Date.now()}@example.com`,
  });

  // The pipeline route renders a "no singles yet" empty state instead of the
  // board when the account has zero singles, so the seed is what makes the
  // board assertion meaningful.
  await createSingle({ member, first_name_en: "Chaya" });

  await signIn(page, member.email!);

  await page.getByRole("link", { name: "Shidduchim" }).click();

  // AC-1: nothing is stored yet, so the desktop default is the Board.
  await expect(
    page.getByRole("button", { name: "Board view" }),
  ).toHaveAttribute("aria-pressed", "true");
  // AC-2: the Board is reachable, and it is NOT the List/Cards position — a
  // `<section aria-label>` (List/Cards) gets an implicit "region" role; the
  // Board's own `<section>` carries no accessible name and gets none.
  await expect(page.getByRole("region", { name: "New" })).toHaveCount(0);
  await expect(page.getByText("New", { exact: true })).toBeVisible();
});

test("member signs in and sees the pipeline list (Mobile Chrome), with no horizontal scroll (AC-2, AC-11)", async ({
  page,
  createMember,
  createSingle,
  signIn,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "Mobile Chrome",
    "the List is Mobile Chrome's default view — see the chromium test above for the Board",
  );

  const member = await createMember({
    first_name: "Ada",
    last_name: "Shadchan",
    email: `e2e-pipeline-list-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });
  await seedShidduch({
    accountId: single.account_id as number,
    singleId: single.id as number,
    nameEn: "Ari Rosenberg",
  });

  await signIn(page, member.email!);

  await page.getByRole("link", { name: "Shidduchim" }).click();

  // AC-1/AC-2: nothing is stored yet, so the mobile default is the List —
  // asserted by accessible name (width-independent, unlike a text-node
  // match against a column label that also appears on the Board).
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("region", { name: /New/ })).toBeVisible();

  // Review fix F1: the jump bar used to be `<a href="#pipeline-section-…">`,
  // which HashRouter reads as a route change — clicking a cell replaced
  // `#/shidduchim` with `#pipeline-section-…` and unmounted the pipeline.
  // Assert the URL survives a click on a non-visible-yet cell. The label and
  // its count are two adjacent `<span>`s — the browser's own accessible-name
  // computation inserts a space between them ("Unsure 0"), so `\s*\d`, not a
  // bare `\b`, is what actually anchors the label end without also matching
  // "Not-sure"'s row by prefix.
  const urlBeforeJump = page.url();
  await page.getByRole("button", { name: /^Unsure\s*\d/ }).click();
  expect(page.url()).toBe(urlBeforeJump);
  await expect(page.getByRole("region", { name: /New/ })).toBeVisible();

  // AC-11: at this phone viewport (Mobile Chrome's Pixel 5 emulation —
  // 393px, not the AC text's illustrative 390px iPhone width; the property
  // is "no horizontal scroll on a phone", not that exact number), neither
  // the document nor any descendant of #main-content scrolls horizontally —
  // the single highest-value assertion in Story 4.3, converting a review
  // checklist item into a CI property.
  const viewportWidth = page.viewportSize()?.width;
  const overflow = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const overflowingDescendant = main
      ? Array.from(main.querySelectorAll("*")).find(
          (el) => el.scrollWidth > el.clientWidth,
        )
      : undefined;
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      hasOverflowingDescendant: Boolean(overflowingDescendant),
      overflowingTag: overflowingDescendant?.tagName,
    };
  });

  expect(
    overflow.documentScrollWidth,
    `document.scrollWidth was ${overflow.documentScrollWidth}, expected ${viewportWidth}`,
  ).toBe(viewportWidth);
  expect(
    overflow.hasOverflowingDescendant,
    `a descendant of #main-content (${overflow.overflowingTag}) has scrollWidth > clientWidth`,
  ).toBe(false);
});

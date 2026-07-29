import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Regression guard for the demo banner's layout shift (loose-end D).
 *
 * `DemoBanner` is the first element of both shells (`Layout` /
 * `MobileLayout`), so it sits in normal flow above `<main>`. It used to
 * render `null` until the `["accountDemo"]` query resolved, then mount its
 * full height — which pushed `<main id="main-content">` from y=0 to y=103 one
 * paint later. Measured here on a cold 390x844 load of Settings: 0.1220 CLS
 * with `MAIN#main-content` as the sole reported source, against 0.0000 with
 * the fix, over repeated runs.
 *
 * Two independent measurements, because they fail differently:
 *  - the CLS score, which is what a user-experience budget is written in; and
 *  - the set of distinct positions `<main>` ever occupied, which is the
 *    geometric claim. The dashboard needs the second one: its own CLS is
 *    ~0 in both arms because its `<main>` is still a skeleton when the
 *    banner lands, so an impact-weighted score cannot see the movement.
 */

/**
 * Own admin client rather than a fixture: `e2e/fixtures.ts` is owned by
 * another workstream this round, so this file does not extend it. Same
 * stack resolution, same service-role key, scoped to the one `accounts.demo`
 * flag this spec needs.
 */
const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Chrome's own CLS threshold for "good" is 0.1; this asserts an order of
 *  magnitude below it, because the banner should now contribute nothing. */
const CLS_BUDGET = 0.01;

/* --------------------------------------------------------------------------
 * `tsconfig.node.json` compiles `e2e/**` with `lib: ["ES2023"]` and no DOM —
 * correct, because a Playwright spec runs in Node. The bodies passed to
 * `addInitScript` / `evaluate` are the exception: they are serialised and run
 * in the page. These declarations describe exactly the browser surface those
 * bodies use and nothing more, so a typo inside them is still a compile
 * error rather than a runtime surprise.
 * ----------------------------------------------------------------------- */

interface BrowserNode {
  tagName?: string;
  id?: string;
}

interface LayoutShiftEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{ node?: BrowserNode | null }>;
}

interface ClsWindow {
  scrollY: number;
  __clsEntries?: Array<{ value: number; sources: string[] }>;
  __clsLastAt?: number;
  __mainTops?: number[];
}

declare const window: ClsWindow;
declare const performance: { now(): number };
declare const document: {
  getElementById(
    id: string,
  ): { getBoundingClientRect(): { top: number } } | null;
  documentElement: BrowserNode;
};
declare function getComputedStyle(node: BrowserNode): {
  getPropertyValue(name: string): string;
};
declare function requestAnimationFrame(callback: () => void): number;
declare class PerformanceObserver {
  constructor(callback: (list: { getEntries(): LayoutShiftEntry[] }) => void);
  observe(options: { type: string; buffered?: boolean }): void;
}

interface ShiftReport {
  cls: number;
  sources: string[];
  /** Every distinct document-relative top `<main id="main-content">` held. */
  mainTops: number[];
}

/**
 * Installed with `addInitScript`, so it runs before the app's first paint on
 * every navigation and reload — a `PerformanceObserver` created after the app
 * boots would miss exactly the shift being measured.
 */
async function observeLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    window.__clsEntries = [];
    window.__clsLastAt = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__clsEntries!.push({
          value: entry.value,
          sources: (entry.sources ?? []).map(({ node }) => {
            if (!node?.tagName) return "(detached)";
            return `${node.tagName}${node.id ? `#${node.id}` : ""}`;
          }),
        });
        window.__clsLastAt = performance.now();
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });

    // Sample the landmark's document-relative top every frame, so "did MAIN
    // move at all" is answerable independently of how much visible content
    // happened to be inside it when it moved.
    window.__mainTops = [];
    const sampleMainTop = () => {
      const main = document.getElementById("main-content");
      if (main) {
        const top = Math.round(
          main.getBoundingClientRect().top + window.scrollY,
        );
        const seen = window.__mainTops!;
        if (seen[seen.length - 1] !== top) seen.push(top);
      }
      requestAnimationFrame(sampleMainTop);
    };
    requestAnimationFrame(sampleMainTop);
  });
}

/**
 * Deterministic settle: poll until no new shift has been recorded for 750ms
 * (`.claude/rules/testing.md` forbids `waitForTimeout`-based assertions —
 * this polls observed state and terminates as soon as the page stops moving).
 */
async function readSettledCls(page: Page): Promise<ShiftReport> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => performance.now() - (window.__clsLastAt ?? 0) > 750,
        ),
      { message: "waiting for layout shifts to stop", timeout: 15000 },
    )
    .toBe(true);

  return page.evaluate(() => {
    const entries = window.__clsEntries ?? [];
    return {
      cls: entries.reduce((total, entry) => total + entry.value, 0),
      sources: [...new Set(entries.flatMap((entry) => entry.sources))],
      mainTops: window.__mainTops ?? [],
    };
  });
}

/**
 * A cold load of `hash`: `goto` puts the SPA on the route, `reload` then
 * replays it as a genuine first load (hash-only navigation never reloads, so
 * without this the second route would inherit a warm query cache and a warm
 * layout — i.e. it would measure nothing).
 */
async function measureColdLoad(page: Page, hash: string): Promise<ShiftReport> {
  await page.goto(`${APP_URL}/#${hash}`);
  await page.reload();
  await expect(page.locator('[data-tour="demo-banner"]')).toBeVisible();
  return readSettledCls(page);
}

/** Seeds a household, flips its demo flag, returns the member to sign in as. */
async function seedDemoHousehold(
  createMember: (input: {
    first_name: string;
    last_name: string;
    email: string;
  }) => Promise<{ user_id: string; email?: string | null }>,
  createSingle: (input: {
    member: { user_id: string };
    first_name_en: string;
  }) => Promise<{ account_id: number }>,
  emailPrefix: string,
) {
  const member = await createMember({
    first_name: "Shift",
    last_name: "Watcher",
    email: `${emailPrefix}-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chaya" });

  const { error } = await adminSupabase
    .from("accounts")
    .update({ demo: true })
    .eq("id", single.account_id);
  expect(error).toBeNull();

  return member;
}

test.use({ viewport: { width: 390, height: 844 } });

test("the demo banner adds no layout shift on a cold mobile load", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await seedDemoHousehold(createMember, createSingle, "e2e-cls");

  await observeLayoutShifts(page);
  await signIn(page, member.email!);

  // Wait for the banner to appear before measuring anything. This is what
  // makes the measurement deterministic rather than a race: it proves
  // `current_account_demo()` has resolved at least once, which is the
  // precondition for the reserved-height fix (the previous answer has to
  // exist before it can be reused). Without it, a fast machine can `reload()`
  // before the very first read lands and measure the genuinely unfixable
  // first-load-on-a-device case instead of the one being asserted.
  await expect(page.locator('[data-tour="demo-banner"]')).toBeVisible();

  const settings = await measureColdLoad(page, "/settings");
  const dashboard = await measureColdLoad(page, "/");

  // Reported so a regression run prints the measured number, not just a
  // pass/fail — the fix was accepted on the size of this value. Written to
  // stdout rather than `console.log` (banned by the repo's `no-console`) and
  // annotated so it also survives into the HTML report.
  const report = (label: string, shift: ShiftReport) => {
    const line = `[cls] ${label}=${shift.cls.toFixed(4)} sources=${shift.sources.join(",")} mainTops=${shift.mainTops.join("→")}`;
    process.stdout.write(`${line}\n`);
    test.info().annotations.push({ type: "cls", description: line });
  };
  report("settings", settings);
  report("dashboard", dashboard);

  expect(settings.cls).toBeLessThan(CLS_BUDGET);
  expect(dashboard.cls).toBeLessThan(CLS_BUDGET);

  // `<main>` is placed once and never moves again.
  expect(settings.mainTops).toHaveLength(1);
  expect(dashboard.mainTops).toHaveLength(1);
});

test("the banner is really on screen, so the shift budget is not vacuous", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  const member = await seedDemoHousehold(
    createMember,
    createSingle,
    "e2e-cls-reserve",
  );

  await signIn(page, member.email!);

  const banner = page.locator('[data-tour="demo-banner"]');
  await expect(banner).toBeVisible();
  const box = await banner.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(40);

  // `--banner-h` is the contract Sidebar/TopBar offset against; a reserved
  // slot that never reported its height would just move the shift into them.
  const bannerVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--banner-h"),
  );
  expect(parseFloat(bannerVar)).toBeGreaterThan(40);
});

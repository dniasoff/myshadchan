import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Sparse/rich-case regression guard for `settings/SingleListingSection.tsx`'s
 * own CLS fix (see that file's Dev Notes) — `e2e/demo-banner-cls.spec.ts`
 * only ever seeds exactly one single, which cannot by itself prove the
 * skeleton is sized from the real count rather than a fixed guess. "A
 * skeleton sized for two rows is itself a shift when the real answer is
 * none" — zero, one, and several singles are asserted here so a
 * regression in any of the three directions is caught.
 *
 * Own `PerformanceObserver('layout-shift')` plumbing rather than importing
 * `demo-banner-cls.spec.ts`'s — that file is the existing, already-passing
 * regression guard and this suite intentionally leaves it untouched.
 */

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Chrome's own "good" threshold is 0.1; an order of magnitude below it
 * matches `demo-banner-cls.spec.ts`'s own budget for the same section. */
const CLS_BUDGET = 0.01;

declare const window: {
  __clsTotal?: number;
  __clsLastAt?: number;
};
declare const performance: { now(): number };
declare class PerformanceObserver {
  constructor(
    callback: (list: {
      getEntries(): Array<{ value: number; hadRecentInput: boolean }>;
    }) => void,
  );
  observe(options: { type: string; buffered?: boolean }): void;
}

/** Installed with `addInitScript` so it is live before the app's first
 * paint on every navigation — mirrors `demo-banner-cls.spec.ts`'s own
 * `observeLayoutShifts`. */
async function observeLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    window.__clsTotal = 0;
    window.__clsLastAt = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__clsTotal = (window.__clsTotal ?? 0) + entry.value;
        window.__clsLastAt = performance.now();
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  });
}

/** Polls until 750ms have passed with no new shift, then returns the
 * accumulated total — the same settle condition `demo-banner-cls.spec.ts`
 * uses, so "several cold loads" below means several genuinely-settled
 * measurements, not a fixed sleep. */
async function readSettledCls(page: Page): Promise<number> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => performance.now() - (window.__clsLastAt ?? 0) > 750,
        ),
      { message: "waiting for layout shifts to stop", timeout: 15000 },
    )
    .toBe(true);
  return page.evaluate(() => window.__clsTotal ?? 0);
}

/** A cold load of `/settings`: `goto` then `reload` so hash-only navigation
 * (which never reloads) doesn't inherit a warm layout — same rationale as
 * `demo-banner-cls.spec.ts`'s own `measureColdLoad`. */
async function measureColdSettingsLoad(page: Page): Promise<number> {
  await observeLayoutShifts(page);
  await page.goto(`${APP_URL}/#/settings`);
  await page.reload();
  // Demo-independent settle signal (this suite never seeds `accounts.demo`,
  // unlike `demo-banner-cls.spec.ts`) — both `SettingsPage.tsx` and
  // `SettingsPageMobile.tsx` render this same translated `<h1>`.
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  return readSettledCls(page);
}

/**
 * Provisions a household directly through the service-role client — the
 * same shape `fixtures.ts`'s own `createSingle` establishes (account +
 * `parent_admin` membership), but with an explicit, caller-chosen list of
 * `singles` rows so the sparse (zero) and rich (several) cases are
 * reachable, not just the always-one shape `createSingle` hard-codes.
 */
async function seedHousehold(
  createMember: (input: {
    first_name: string;
    last_name: string;
    email: string;
  }) => Promise<{ user_id: string; email?: string | null }>,
  emailPrefix: string,
  singleNames: string[],
) {
  const member = await createMember({
    first_name: "Row",
    last_name: "Count",
    email: `${emailPrefix}-${Date.now()}@example.com`,
  });

  // ONE call, not two inserts: assert_account_not_orphaned() rejects a
  // committed account with no active membership, and PostgREST gives each
  // request its own transaction, so insert-then-insert commits an orphan in
  // between. Same reasoning as e2e/fixtures.ts createHousehold().
  const { data: created, error: accountError } = await adminSupabase.rpc(
    "create_account_with_owner",
    {
      p_name: `E2E ${emailPrefix} household`,
      p_kind: "household",
      p_user_id: member.user_id,
      p_role: "parent_admin",
    },
  );
  if (accountError || !created) {
    throw new Error(`Failed to create account: ${accountError?.message}`);
  }
  const account = { id: (created as { account_id: number }).account_id };

  if (singleNames.length > 0) {
    const { error: singlesError } = await adminSupabase.from("singles").insert(
      singleNames.map((first_name_en) => ({
        account_id: account.id,
        first_name_en,
      })),
    );
    if (singlesError) {
      throw new Error(`Failed to create singles: ${singlesError.message}`);
    }
  }

  return member;
}

test.use({ viewport: { width: 390, height: 844 } });

/**
 * Runs `measureColdSettingsLoad` `times` times in a row on the SAME
 * already-signed-in page — "several cold loads" per the fix's own
 * requirement, not one lucky run. Each iteration re-observes from a fresh
 * `addInitScript` (registered before its own `reload()`), so later
 * iterations are not measuring residue from earlier ones.
 */
async function measureSeveralColdLoads(
  page: Page,
  times: number,
): Promise<number[]> {
  const results: number[] = [];
  for (let i = 0; i < times; i++) {
    results.push(await measureColdSettingsLoad(page));
  }
  return results;
}

for (const scenario of [
  { label: "zero singles (sparse)", names: [] as string[] },
  { label: "one single", names: ["Chaya"] },
  {
    label: "several singles (rich)",
    names: ["Chaya", "Devorah", "Esther", "Faiga"],
  },
]) {
  test(`no layout shift settling SingleListingSection with ${scenario.label}, across several cold loads`, async ({
    page,
    createMember,
    signIn,
  }) => {
    const member = await seedHousehold(
      createMember,
      scenario.label.replace(/[^a-z0-9]+/gi, "-"),
      scenario.names,
    );

    await signIn(page, member.email!);
    // The shell-level hint (`root/singleListingShapeHint.ts`) only helps a
    // cold Settings load once it has actually been written — deterministic
    // precondition (not a timeout), mirroring `demo-banner-cls.spec.ts`'s
    // own "wait for the banner before measuring anything" rationale.
    await page.waitForFunction(
      () =>
        localStorage.getItem("RaStoreCRM.settings.singleListing.lastShape") !==
        null,
    );

    const measurements = await measureSeveralColdLoads(page, 3);

    for (const [index, cls] of measurements.entries()) {
      expect(
        cls,
        `cold load #${index + 1} for ${scenario.label}: ${cls.toFixed(4)}`,
      ).toBeLessThan(CLS_BUDGET);
    }
  });
}

import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Regression guard for the dashboard reminders card's layout shift (Story
 * 12.1, gap D1, AC-2). Modelled directly on `e2e/demo-banner-cls.spec.ts`'s
 * second measurement — the geometric one, not the CLS score — because that
 * spec's own doc comment (`:18-24`) explains why the CLS score alone cannot
 * see this class of shift on the dashboard route: `useDashboardData` gates
 * the whole page behind `if (isPending) return null`
 * (`dashboard/Dashboard.tsx:28`), so everything mounts in one paint and an
 * impact-weighted score is blind to whatever moves one paint later, once
 * this card's own query resolves.
 *
 * `[data-tour="pipeline-snapshot"]` is the anchor: `DueRemindersCard`
 * mounts ABOVE it on both `Dashboard.tsx` and `MobileDashboard.tsx` (Task 3),
 * so if the card's list region were not a fixed height, the snapshot would
 * move down the page the moment the card's own reminders query landed —
 * exactly the shape `DemoBanner.tsx:37-61` documents for `<main>`.
 */

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface ClsWindow {
  __pipelineTops?: number[];
  __pipelineLastAt?: number;
}

declare const window: ClsWindow;
declare const performance: { now(): number };
declare const document: {
  querySelector(
    selector: string,
  ): { getBoundingClientRect(): { top: number } } | null;
};
declare function requestAnimationFrame(callback: () => void): number;

/**
 * Installed with `addInitScript` so it is live before the app's first paint
 * on every navigation/reload — sampling this only after the app boots would
 * miss exactly the shift being measured, the same reasoning
 * `demo-banner-cls.spec.ts`'s own `observeLayoutShifts` documents.
 */
async function observePipelineSnapshotTop(page: Page) {
  await page.addInitScript(() => {
    window.__pipelineTops = [];
    window.__pipelineLastAt = 0;
    const sample = () => {
      const el = document.querySelector('[data-tour="pipeline-snapshot"]');
      if (el) {
        const top = Math.round(el.getBoundingClientRect().top);
        const seen = window.__pipelineTops!;
        if (seen[seen.length - 1] !== top) {
          seen.push(top);
          window.__pipelineLastAt = performance.now();
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Deterministic settle, same idiom as `demo-banner-cls.spec.ts`'s
 * `readSettledCls` — polls observed state, never `waitForTimeout`
 * (`.claude/rules/testing.md`). */
async function readSettledPipelineTops(page: Page): Promise<number[]> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => performance.now() - (window.__pipelineLastAt ?? 0) > 750,
        ),
      {
        message: "waiting for the pipeline snapshot to stop moving",
        timeout: 15000,
      },
    )
    .toBe(true);

  return page.evaluate(() => window.__pipelineTops ?? []);
}

/** Seeds a household with one single, one shidduch (so the populated
 * dashboard branch renders — Task 3's "Recorded scope decision": the card
 * only mounts in the `hasSuggestions` branch) and one overdue reminder, so
 * the card's own query resolves with real content rather than the (also
 * fixed-height, but visually different) empty state. */
async function seedHouseholdWithAnOverdueReminder(
  createMember: (input: {
    first_name: string;
    last_name: string;
    email: string;
  }) => Promise<{ user_id: string; email?: string | null }>,
  createSingle: (input: {
    member: { user_id: string };
    first_name_en: string;
  }) => Promise<{ id: number; account_id: number }>,
  createShidduch: (input: {
    accountId: number;
    singleId: number;
    nameEn: string;
  }) => Promise<{ id: number }>,
  emailPrefix: string,
) {
  const member = await createMember({
    first_name: "Reminder",
    last_name: "Watcher",
    email: `${emailPrefix}-${Date.now()}@example.com`,
  });
  const single = await createSingle({ member, first_name_en: "Chana" });
  const shidduch = await createShidduch({
    accountId: single.account_id,
    singleId: single.id,
    nameEn: "Ari Cohen",
  });

  const { error } = await adminSupabase.from("tasks").insert({
    account_id: single.account_id,
    target_type: "shidduch",
    target_id: shidduch.id,
    text: "Follow up on Ari Cohen",
    due_date: "2020-01-01T00:00:00.000Z",
  });
  expect(error).toBeNull();

  return member;
}

test.use({ viewport: { width: 390, height: 844 } });

test("the dashboard reminders card adds no layout shift to the pipeline snapshot on a cold mobile load", async ({
  page,
  createMember,
  createSingle,
  createShidduch,
  signIn,
}) => {
  const member = await seedHouseholdWithAnOverdueReminder(
    createMember,
    createSingle,
    createShidduch,
    "e2e-reminders-cls",
  );

  await observePipelineSnapshotTop(page);
  await signIn(page, member.email!);

  await page.goto(`${APP_URL}/#/`);
  await page.reload();
  await expect(page.locator('[data-tour="pipeline-snapshot"]')).toBeVisible();

  const tops = await readSettledPipelineTops(page);

  process.stdout.write(`[cls] pipelineTops=${tops.join("→")}\n`);
  test.info().annotations.push({
    type: "cls",
    description: `pipelineTops=${tops.join("→")}`,
  });

  // The reminders card's own query resolving must not move the landmark
  // below it — exactly one distinct top, the whole way through the load.
  expect(tops).toHaveLength(1);
});

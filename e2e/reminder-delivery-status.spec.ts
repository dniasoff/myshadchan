import { createClient } from "@supabase/supabase-js";

import { supabaseUrlFromEnv } from "../scripts/stack-env.mjs";
import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 12.2, AC-9: the Settings → Preferences reminder-delivery heartbeat
 * row is the anti-recurrence control for this story's own defect — a dead
 * sweep and a healthy sweep must never look the same from inside the app.
 * `cron_heartbeat` carries no `account_id` (it is deliberately outside the
 * tenant model — see `05_policies.sql`'s own comment on why `using (true)`
 * is defensible there), so it is seeded directly through the service-role
 * client rather than through any per-household fixture helper.
 */

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Deterministic settle: the row itself is what's under test, so wait on
 * ITS text rather than a fixed delay — never `waitForTimeout`. */
const DELIVERY_ROW_LABEL = "Reminder emails";

test("reads 'Not set up yet' when no heartbeat row has ever been written — the true state of a fresh deploy", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange — resetDb() (auto fixture) already truncated cron_heartbeat, so
  // no seeding is needed to reach the empty-table case.
  const member = await createMember({
    first_name: "Not",
    last_name: "SetUp",
    email: `e2e-heartbeat-empty-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Chaya" });
  await signIn(page, member.email!);

  // Act
  await page.goto(`${APP_URL}/#/settings`);

  // Assert
  await expect(page.getByText(DELIVERY_ROW_LABEL)).toBeVisible();
  await expect(page.getByText("Not set up yet")).toBeVisible();
  await expect(page.getByText("Sending")).not.toBeVisible();
});

test("reads 'Sending' for a heartbeat that ticked within the last 30 minutes", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange
  const { error } = await adminSupabase.from("cron_heartbeat").upsert({
    worker: "cron",
    last_run_at: new Date().toISOString(),
    last_ok_at: new Date().toISOString(),
    last_error: null,
  });
  expect(error).toBeNull();

  const member = await createMember({
    first_name: "Fresh",
    last_name: "Heartbeat",
    email: `e2e-heartbeat-fresh-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Devorah" });
  await signIn(page, member.email!);

  // Act
  await page.goto(`${APP_URL}/#/settings`);

  // Assert
  await expect(page.getByText(DELIVERY_ROW_LABEL)).toBeVisible();
  await expect(page.getByText("Sending")).toBeVisible();
});

test("reads 'Paused' for a heartbeat stale beyond the 30-minute window", async ({
  page,
  createMember,
  createSingle,
  signIn,
}) => {
  // Arrange
  const staleAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { error } = await adminSupabase.from("cron_heartbeat").upsert({
    worker: "cron",
    last_run_at: staleAt,
    last_ok_at: staleAt,
    last_error: null,
  });
  expect(error).toBeNull();

  const member = await createMember({
    first_name: "Stale",
    last_name: "Heartbeat",
    email: `e2e-heartbeat-stale-${Date.now()}@example.com`,
  });
  await createSingle({ member, first_name_en: "Esther" });
  await signIn(page, member.email!);

  // Act
  await page.goto(`${APP_URL}/#/settings`);

  // Assert
  await expect(page.getByText(DELIVERY_ROW_LABEL)).toBeVisible();
  await expect(page.getByText("Paused")).toBeVisible();
  await expect(page.getByText("Sending")).not.toBeVisible();
});

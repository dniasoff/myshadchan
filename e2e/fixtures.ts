import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { resolveStack, supabaseUrlFromEnv } from "../scripts/stack-env.mjs";

/**
 * Everything below is scoped to one test stack, selected by `STACK_ID`.
 *
 * This matters more here than anywhere else in the repo: `resetDb()` is an
 * `auto: true` fixture, so it truncates before *every* e2e test. When the URL
 * was a fixed `127.0.0.1:54341`, two agents running Playwright against the
 * same checkout truncated each other's database mid-assertion — no amount of
 * file-ownership discipline prevents that. `supabaseUrlFromEnv` makes STACK_ID
 * authoritative over an inherited `VITE_SUPABASE_URL` precisely so a stale env
 * var cannot aim this truncation at another agent's stack; with STACK_ID unset
 * it falls back to `VITE_SUPABASE_URL ?? 54341`, exactly as before.
 */
const stack = resolveStack(process.env.STACK_ID);

/** The app origin under test — the stack's own Vite dev server. */
export const APP_URL = stack.appUrl;

// The e2e stack's own Mailpit instance (config.e2e.toml's [inbucket] block) —
// not the dev stack's Mailpit on 54324. Sign-in is passwordless (email-OTP,
// story 2.6): `signIn()` reads the 6-digit code straight out of here.
const MAILPIT_URL = stack.mailpitUrl;

const adminSupabase = createClient(
  supabaseUrlFromEnv(process.env),
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Tables in FK-safe deletion order (children before parents). Deleting
// "accounts" cascades away every domain row scoped to it (account_members,
// singles, shidduchim, shadchanim, references, invites, …) — see
// supabase/schemas/01_tables.sql's `on delete cascade` foreign keys — which
// is what makes resetDb() safe to call between Playwright projects: without
// it, stale rows from a previous run would leak into the next. Story 2.7
// deleted handle_new_user()'s first-user bootstrap (membership now binds
// from an invite instead), so createSingle() below provisions its own
// account + membership directly rather than relying on any signup side
// effect.
const TABLES = ["tasks", "accounts", "configuration", "members"];

async function resetDb() {
  for (const table of TABLES) {
    // Supabase client delete need a where clause to get executed, so we use one that will match on all rows (id is not null)
    await adminSupabase.from(table).delete().not("id", "is", null);
  }

  // Delete all auth users (cascades to members via DB trigger)
  const { data } = await adminSupabase.auth.admin.listUsers();
  await Promise.all(
    data.users.map((user) => adminSupabase.auth.admin.deleteUser(user.id)),
  );
}

async function createMember({
  first_name,
  last_name,
  email,
}: {
  first_name: string;
  last_name: string;
  email: string;
}) {
  const { data: userData, error: userError } =
    await adminSupabase.auth.admin.createUser({
      email,
      // Confirmed up front: sign-in is passwordless (email-OTP, shouldCreateUser:
      // false) and only reaches an already-confirmed user.
      email_confirm: true,
    });

  if (userError) {
    throw new Error(`Failed to create member: ${userError.message}`);
  }

  const { data, error } = await adminSupabase
    .from("members")
    .update({ first_name, last_name, administrator: false })
    .eq("user_id", userData.user?.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create member: ${error.message}`);
  }

  return data;
}

async function createSingle({
  member,
  first_name_en,
}: {
  member: { user_id: string };
  first_name_en: string;
}) {
  // Story 2.7 deleted handle_new_user()'s first-user bootstrap — a member
  // created via admin.createUser() (createMember above) gets NO
  // account_members row at all (the before_user_created Auth Hook does not
  // gate service-role user creation, and membership now binds from an
  // invite, not a signup side effect). The service-role client bypasses
  // RLS, so this provisions the household + membership directly, mirroring
  // the platform-ops genesis-seed runbook story 2.7's Dev Notes describe —
  // two inserts, not a lookup of something a trigger used to create.
  const { data: account, error: accountError } = await adminSupabase
    .from("accounts")
    .insert({ name: "E2E Household" })
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(`Failed to create account: ${accountError?.message}`);
  }

  const { error: membershipError } = await adminSupabase
    .from("account_members")
    .insert({
      account_id: account.id,
      user_id: member.user_id,
      role: "parent_admin",
      status: "active",
    });

  if (membershipError) {
    throw new Error(
      `Failed to create account membership for member ${member.user_id}: ${membershipError.message}`,
    );
  }

  const { data, error } = await adminSupabase
    .from("singles")
    .insert({ account_id: account.id, first_name_en })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create single: ${error.message}`);
  }

  return data;
}

/**
 * Story 6.5 review fix (AC-3's tab half): provisions a SELF-MANAGER
 * household directly — a household whose only membership is `role =
 * 'self_manager'`, with a `singles` row linked back to it by `member_id`
 * (the same "one household, self-managed" shape `add_persona('single')`
 * produces — mirrors `createSingle` above, differing only in `role` and the
 * `member_id` link). Provisioned directly through the service-role client,
 * exactly like `createSingle`, rather than by calling `add_persona()`
 * through an authenticated session this fixture has no reason to open.
 *
 * Exists so `navigation.spec.ts` can sign in as a REAL self-manager and
 * prove — through the actual app, not a unit fixture — that every tab
 * Stories 6.2/6.3 restrict still names `self_manager` in its `visibleTo`
 * allow-list (`singles/entityDescriptor.tsx`, `shidduchim/entityDescriptor
 * .tsx`): no unit test reads those two files' arrays directly, so dropping
 * `self_manager` from one is silent everywhere else (review finding #3).
 */
async function createSelfManagedSingle({
  member,
  first_name_en,
}: {
  member: { user_id: string };
  first_name_en: string;
}) {
  const { data: account, error: accountError } = await adminSupabase
    .from("accounts")
    .insert({ name: "E2E Self-Managed Household" })
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(`Failed to create account: ${accountError?.message}`);
  }

  const { data: membership, error: membershipError } = await adminSupabase
    .from("account_members")
    .insert({
      account_id: account.id,
      user_id: member.user_id,
      role: "self_manager",
      status: "active",
    })
    .select()
    .single();

  if (membershipError || !membership) {
    throw new Error(
      `Failed to create self-manager membership for member ${member.user_id}: ${membershipError?.message}`,
    );
  }

  const { data, error } = await adminSupabase
    .from("singles")
    .insert({
      account_id: account.id,
      first_name_en,
      member_id: membership.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create self-managed single: ${error.message}`);
  }

  return data;
}

/**
 * Seeds a bare shidduch directly against an already-provisioned account/
 * single — the minimal shape needed to open every one of Story 6.5's
 * restricted-tab checks (overview/medical/files/diligence/external-links/
 * notes/tasks/activity all render off the record alone, no further data
 * required).
 */
async function createShidduch({
  accountId,
  singleId,
  nameEn,
}: {
  accountId: number;
  singleId: number;
  nameEn: string;
}) {
  const { data, error } = await adminSupabase
    .from("shidduchim")
    .insert({ account_id: accountId, single_id: singleId, name_en: nameEn })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create shidduch "${nameEn}": ${error?.message}`);
  }

  return data;
}

/**
 * Story 4.1: seeds a shadchan row directly against an already-provisioned
 * account (`single.account_id`, itself created by `createSingle` above) —
 * unlike `createSingle`/`createInvite`, this does NOT provision its own
 * account, so two calls with the same `accountId` land two shadchanim on
 * the SAME household's book (what `entity-list-search.spec.ts` needs to
 * prove search narrows the roster rather than merely emptying it).
 */
async function createShadchan({
  accountId,
  name,
}: {
  accountId: number;
  name: string;
}) {
  const { data, error } = await adminSupabase
    .from("shadchanim")
    .insert({ account_id: accountId, name })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create shadchan: ${error.message}`);
  }

  return data;
}

/**
 * Story 4.4: gives an already-created member a SECOND context (a
 * shadchanus-kind account, alongside the household `createSingle`
 * provisions) — `ContextSwitcher`/`ContextMenuItems` render nothing below 2
 * contexts (2.4 AC-1), so the navigation e2e spec needs a real second
 * membership to see the switcher at all. `enforce_membership_role_matches_
 * context()` (04_triggers.sql) restricts the `shadchan` role to a
 * shadchanus-kind account, so both inserts must agree on `kind`/`role`.
 */
async function createSecondContext({
  member,
  name,
}: {
  member: { user_id: string };
  name: string;
}) {
  const { data: account, error: accountError } = await adminSupabase
    .from("accounts")
    .insert({ name, kind: "shadchanus" })
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(
      `Failed to create second-context account: ${accountError?.message}`,
    );
  }

  const { error: membershipError } = await adminSupabase
    .from("account_members")
    .insert({
      account_id: account.id,
      user_id: member.user_id,
      role: "shadchan",
      status: "active",
    });

  if (membershipError) {
    throw new Error(
      `Failed to create second-context membership for member ${member.user_id}: ${membershipError.message}`,
    );
  }

  return account;
}

/**
 * Seeds a pending invite directly (Story 2.7) — the same shape as the
 * platform-ops genesis seed the story's Dev Notes describe (two inserts:
 * one account, one invite row), not a call to create_invite() itself, since
 * that requires an already-authenticated inviting session this fixture has
 * no reason to set up. `invited_by` stays null, exactly like the genesis
 * case: RLS on `invites` requires service_role for that shape (AC-2), which
 * this admin client is.
 */
async function createInvite({ email, role }: { email: string; role: string }) {
  const { data: account, error: accountError } = await adminSupabase
    .from("accounts")
    .insert({ name: "E2E Invite Household" })
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(`Failed to create account: ${accountError?.message}`);
  }

  const { data: invite, error: inviteError } = await adminSupabase
    .from("invites")
    .insert({ email, account_id: account.id, role })
    .select()
    .single();

  if (inviteError || !invite) {
    throw new Error(`Failed to create invite: ${inviteError?.message}`);
  }

  return { token: invite.token as string, accountName: account.name as string };
}

interface MailpitSearchResponse {
  messages?: Array<{ ID: string }>;
}

interface MailpitMessage {
  Text?: string;
  HTML?: string;
}

/**
 * Reads the 6-digit email-OTP code most recently sent to `email` off the
 * e2e stack's Mailpit (54344 — see MAILPIT_URL above), polling deterministically
 * (`expect.poll`, never `waitForTimeout` per .claude/rules/testing.md) until the
 * message lands.
 */
export async function fetchOtpCode(email: string): Promise<string> {
  let code: string | undefined;

  await expect
    .poll(
      async () => {
        const searchResponse = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const { messages } =
          (await searchResponse.json()) as MailpitSearchResponse;
        const latestId = messages?.[0]?.ID;
        if (!latestId) {
          return null;
        }

        const messageResponse = await fetch(
          `${MAILPIT_URL}/api/v1/message/${latestId}`,
        );
        const message = (await messageResponse.json()) as MailpitMessage;
        const body = message.Text ?? message.HTML ?? "";
        code = body.match(/\b(\d{6})\b/)?.[1];
        return code ?? null;
      },
      {
        message: `waiting for the OTP email sent to ${email}`,
        timeout: 15000,
      },
    )
    .not.toBeNull();

  if (!code) {
    throw new Error(`No 6-digit code found in the OTP email sent to ${email}`);
  }

  return code;
}

/**
 * Drives the two-step passwordless login form (story 2.6): email step, then
 * the code step, reading the code from Mailpit rather than a clickable link
 * (AD-11 — email-OTP is the native path, not a magic link).
 *
 * Clicking "Sign in" only *starts* the login: `authProvider.login()` resolves
 * asynchronously and ra-core's `useLogin()` then navigates to the
 * authenticated shell. Returning immediately after the click used to race
 * that redirect — a caller's own `page.goto("#/some-route")` right after
 * `signIn()` could land first and then get stomped when the app's redirect
 * to "#/" finally fired (see e2e/invite-sending.spec.ts's history: the
 * "#invite-email" locator kept timing out because the URL had bounced back
 * to "#/" underneath it). Waiting here for the "Shidduchim" nav link — the
 * same universal anchor pipeline.spec.ts already asserts on (relabelled from
 * "Pipeline" by Story 4.4) — closes that race for every caller, present and
 * future: it's rendered by both the desktop Sidebar and the mobile bottom
 * nav (PRIMARY_NAV), unlike e.g. "Settings", which is tucked behind a
 * "More" dropdown on mobile.
 */
async function signIn(page: Page, email: string) {
  await page.goto(`${APP_URL}/#/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();

  const code = await fetchOtpCode(email);

  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Shidduchim" })).toBeVisible();
}

export const test = base.extend<{
  resetDb: void;
  createMember: typeof createMember;
  createSingle: typeof createSingle;
  createSelfManagedSingle: typeof createSelfManagedSingle;
  createShidduch: typeof createShidduch;
  createShadchan: typeof createShadchan;
  createSecondContext: typeof createSecondContext;
  createInvite: typeof createInvite;
  signIn: typeof signIn;
}>({
  // The first argument to a Playwright fixture function must use object destructuring ({}) — _ is not allowed.
  // Playwright uses this to statically analyze which fixtures are requested.
  // One disable/enable pair below covers every zero-dependency fixture,
  // rather than repeating a per-line suppression on each of them.
  /* eslint-disable no-empty-pattern */
  resetDb: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
  createMember: async ({}, cb) => {
    await cb(createMember);
  },
  createSingle: async ({}, cb) => {
    await cb(createSingle);
  },
  createSelfManagedSingle: async ({}, cb) => {
    await cb(createSelfManagedSingle);
  },
  createShidduch: async ({}, cb) => {
    await cb(createShidduch);
  },
  createShadchan: async ({}, cb) => {
    await cb(createShadchan);
  },
  createSecondContext: async ({}, cb) => {
    await cb(createSecondContext);
  },
  createInvite: async ({}, cb) => {
    await cb(createInvite);
  },
  signIn: async ({}, cb) => {
    await cb(signIn);
  },
  /* eslint-enable no-empty-pattern */
});

export { expect };

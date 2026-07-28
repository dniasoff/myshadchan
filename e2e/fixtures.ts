import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The e2e stack's own Mailpit instance (config.e2e.toml's [inbucket] block) —
// not the dev stack's Mailpit on 54324. Sign-in is passwordless (email-OTP,
// story 2.6): `signIn()` reads the 6-digit code straight out of here.
const MAILPIT_URL = "http://127.0.0.1:54344";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
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
 */
async function signIn(page: Page, email: string) {
  await page.goto("http://localhost:5175/#/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();

  const code = await fetchOtpCode(email);

  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export const test = base.extend<{
  resetDb: void;
  createMember: typeof createMember;
  createSingle: typeof createSingle;
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
  createInvite: async ({}, cb) => {
    await cb(createInvite);
  },
  signIn: async ({}, cb) => {
    await cb(signIn);
  },
  /* eslint-enable no-empty-pattern */
});

export { expect };

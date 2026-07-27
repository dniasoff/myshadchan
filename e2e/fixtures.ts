import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Tables in FK-safe deletion order (children before parents). Deleting
// "accounts" cascades away every domain row scoped to it (account_members,
// singles, shidduchim, shadchanim, references, …) — see
// supabase/schemas/01_tables.sql's `on delete cascade` foreign keys — which
// is what makes resetDb() safe to call between Playwright projects: without
// it, `account_members` rows survive a `members` wipe (no cascade on that
// FK) and the next signed-up user is no longer treated as the account's
// first member by handle_new_user(), so it never gets a membership.
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

async function createUser({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return data.user;
}

async function createMember({
  first_name,
  last_name,
  email,
  password,
}: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}) {
  const { data: userData, error: userError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
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
  // The service-role client bypasses set_account_id_default (its backing
  // current_account_id() reads the caller's own membership, and service_role
  // has none), so the account_id has to be looked up and passed explicitly —
  // read off the account membership the signed-up member's handle_new_user()
  // trigger created.
  const { data: membership, error: membershipError } = await adminSupabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", member.user_id)
    .single();

  if (membershipError || !membership) {
    throw new Error(
      `Failed to find an account membership for member ${member.user_id}: ${membershipError?.message}`,
    );
  }

  const { data, error } = await adminSupabase
    .from("singles")
    .insert({ account_id: membership.account_id, first_name_en })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create single: ${error.message}`);
  }

  return data;
}

const getMenuMethod = ({ page }: { page: Page; isMobile: boolean }) => ({
  goToDashboard: async () => {
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.waitForLoadState("networkidle");
  },
});

const dismissToast = async (page: Page, content: string) => {
  await expect(page.getByText(content)).toBeVisible();
  await page.getByLabel("Close toast").first().click();
  // Since we are in optimistic UI, dismissing the toast trigger the request to the api linked to the toast message
  await page.waitForLoadState("networkidle");
};

export const test = base.extend<{
  resetDb: void;
  createUser: typeof createUser;
  createMember: typeof createMember;
  createSingle: typeof createSingle;
  menu: ReturnType<typeof getMenuMethod>;
  dismissToast: (content: string) => Promise<void>;
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
  createUser: async ({}, cb) => {
    await cb(createUser);
  },
  createMember: async ({}, cb) => {
    await cb(createMember);
  },
  createSingle: async ({}, cb) => {
    await cb(createSingle);
  },
  /* eslint-enable no-empty-pattern */
  menu: async ({ page, isMobile }, cb) => {
    await cb(getMenuMethod({ page, isMobile }));
  },
  dismissToast: async ({ page }, cb) => {
    await cb((content: string) => dismissToast(page, content));
  },
});

export { expect };

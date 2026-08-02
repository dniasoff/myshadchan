import type { DataProvider, Identifier } from "ra-core";

import type {
  Account,
  AccountMember,
  Member,
  MyPersona,
  Persona,
  Single,
} from "../../../types";
import {
  activeMembershipsFor,
  SORT_BY_ID,
  type GetIdentity,
} from "./accountMemberships";

/**
 * FakeRest mirrors of `public.my_personas()` / `public.add_persona()`
 * (2.2 AC-6/AC-8, wired here per 2.3 AC-8/AD-10). Every predicate below is
 * copied from `supabase/schemas/02_functions.sql`, not reinvented — keep the
 * two in lockstep by hand, since there is no shared source across the
 * Postgres/TypeScript boundary. `account_members`/`singles` are the only
 * state read or written; nothing is cached beyond a single call.
 */

// Mirrors public.is_owning_membership_role(): the two roles entitled to have
// a household's `single` persona attached to them, and the only ones
// addPersona('parent') ever promotes in place.
const isOwningMembershipRole = (role: AccountMember["role"]): boolean =>
  role === "parent_admin" || role === "self_manager";

// This predicate must match my_personas()'s single-detection exactly (same
// comment as 02_functions.sql): a `singles` row already points at this
// membership.
const hasLinkedSingle = async (
  baseDataProvider: DataProvider,
  membershipId: Identifier,
): Promise<boolean> => {
  const { data } = await baseDataProvider.getList<Single>("singles", {
    filter: { member_id: membershipId },
    pagination: { page: 1, perPage: 1 },
    sort: SORT_BY_ID,
  });
  return data.length > 0;
};

// Mirrors 02_functions.sql's nullif(v_first_name, 'Pending') guard (2.2
// review finding #4): `members.first_name` is `NOT NULL DEFAULT 'Pending'`
// (01_tables.sql / handle_new_user()), so a signup with no first/given name
// in their OAuth metadata must fall through to "My Account", not the dead
// "Pending's Family".
const PENDING_FIRST_NAME = "Pending";

const householdNameFor = (firstName: string | undefined): string =>
  firstName && firstName !== PENDING_FIRST_NAME
    ? `${firstName}'s Family`
    : "My Account";

/** FakeRest mirror of `public.my_personas()` — derives, never stores. */
export async function getMyPersonas(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
): Promise<MyPersona[]> {
  const identity = await getIdentity();
  if (identity == null) {
    return [];
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  if (memberships.length === 0) {
    return [];
  }

  const accountCache = new Map<Identifier, Account>();
  const loadAccount = async (accountId: Identifier): Promise<Account> => {
    const cached = accountCache.get(accountId);
    if (cached) return cached;
    const { data } = await baseDataProvider.getOne<Account>("accounts", {
      id: accountId,
    });
    accountCache.set(accountId, data);
    return data;
  };

  const personas: MyPersona[] = [];

  for (const membership of memberships) {
    if (membership.role === "parent_admin") {
      const account = await loadAccount(membership.account_id);
      personas.push({
        persona: "parent",
        account_id: membership.account_id,
        account_kind: account.kind,
        role: membership.role,
      });
    }

    if (membership.role === "shadchan") {
      const account = await loadAccount(membership.account_id);
      personas.push({
        persona: "shadchan",
        account_id: membership.account_id,
        account_kind: account.kind,
        role: membership.role,
      });
    }

    if (
      membership.role === "single" ||
      isOwningMembershipRole(membership.role)
    ) {
      if (await hasLinkedSingle(baseDataProvider, membership.id)) {
        const account = await loadAccount(membership.account_id);
        personas.push({
          persona: "single",
          account_id: membership.account_id,
          account_kind: account.kind,
          role: membership.role,
        });
      }
    }
  }

  return personas;
}

/**
 * FakeRest mirror of `public.add_persona()`. Mutates the in-memory `db` the
 * same way the SQL function mutates real tables — create a household /
 * `singles` row / shadchanus account as needed — and is idempotent per
 * persona, matching every no-op predicate `getMyPersonas` above reports.
 */
export async function addPersona(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  persona: Persona,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("addPersona requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);

  const createHousehold = async (
    role: Extract<AccountMember["role"], "parent_admin" | "self_manager">,
  ): Promise<AccountMember> => {
    const { data: caller } = await baseDataProvider.getOne<Member>("members", {
      id: identity.id,
    });
    const { data: account } = await baseDataProvider.create<Account>(
      "accounts",
      {
        data: {
          name: householdNameFor(caller?.first_name),
          transparency_level: "shared",
          kind: "household",
          default_thread_visibility: "open",
          created_at: new Date().toISOString(),
        },
      },
    );
    const { data: membership } = await baseDataProvider.create<AccountMember>(
      "account_members",
      {
        data: {
          account_id: account.id,
          user_id: userId,
          role,
          status: "active",
          created_at: new Date().toISOString(),
        },
      },
    );
    return membership;
  };

  if (persona === "parent") {
    if (memberships.some((m) => m.role === "parent_admin")) {
      return; // no-op: already an active parent_admin
    }

    // Promote an existing self_manager membership in place — never rewrite
    // account_id, the household is already valid.
    const selfManager = memberships.find((m) => m.role === "self_manager");
    if (selfManager) {
      await baseDataProvider.update<AccountMember>("account_members", {
        id: selfManager.id,
        data: { role: "parent_admin" },
        previousData: selfManager,
      });
      return;
    }

    await createHousehold("parent_admin");
    return;
  }

  if (persona === "single") {
    const eligible = memberships.filter(
      (m) => m.role === "single" || isOwningMembershipRole(m.role),
    );
    for (const membership of eligible) {
      if (await hasLinkedSingle(baseDataProvider, membership.id)) {
        return; // no-op: already attached
      }
    }

    // Attach to an existing OWNING membership if the caller has one — never
    // a helper's household.
    let target = memberships.find((m) => isOwningMembershipRole(m.role));
    if (!target) {
      target = await createHousehold("self_manager");
    }

    await baseDataProvider.create<Single>("singles", {
      data: {
        account_id: target.account_id,
        member_id: target.id,
        status: "active",
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

  if (persona === "shadchan") {
    if (memberships.some((m) => m.role === "shadchan")) {
      return; // no-op: already an active shadchan
    }

    // The SQL (02_functions.sql) inserts `(kind)` only — never `name` — so
    // the real row's name is the column default 'My Account'
    // (01_tables.sql), not a derived "<first name>'s Shadchanus" (2.2 review
    // finding #4: that name was invented here, not copied from the SQL).
    const { data: account } = await baseDataProvider.create<Account>(
      "accounts",
      {
        data: {
          name: "My Account",
          transparency_level: "shared",
          kind: "shadchanus",
          default_thread_visibility: "open",
          created_at: new Date().toISOString(),
        },
      },
    );
    await baseDataProvider.create<AccountMember>("account_members", {
      data: {
        account_id: account.id,
        user_id: userId,
        role: "shadchan",
        status: "active",
        created_at: new Date().toISOString(),
      },
    });
    return;
  }
}

import type { DataProvider, Identifier } from "ra-core";

import type { AccountMember, Persona, Single } from "../../../types";
import { getMyPersonas } from "./personas";
import {
  activeMembershipsFor,
  SORT_BY_ID,
  type GetIdentity,
} from "./accountMemberships";

/**
 * FakeRest mirror of `public.remove_persona()` (2.5 AC-2/AC-3/AC-5/AC-7).
 * Every predicate below is copied from `supabase/schemas/02_functions.sql`,
 * not reinvented — keep the two in lockstep by hand, exactly like
 * `./personas.ts`'s own header comment. Archives, never deletes: the only
 * mutations here are `update` calls setting `status`/`role`, never a
 * `delete`.
 */

// Mirrors public.is_owning_membership_role(): the two roles entitled to have
// a household's `single` persona attached to them.
const isOwningMembershipRole = (role: AccountMember["role"]): boolean =>
  role === "parent_admin" || role === "self_manager";

export async function removePersona(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  persona: Persona,
  getActiveAccountId: () => Identifier | null,
  setActiveAccountId: (accountId: Identifier | null) => void,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("removePersona requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);

  // AC-7: if the membership being archived was the caller's active context,
  // hand off to any other remaining active membership, or clear to NULL if
  // none remain — mirroring activate_context_for()'s NULL-write half, which
  // switchActiveContext()'s own guard (contexts.ts) cannot express.
  const archiveMembership = async (
    membership: AccountMember,
  ): Promise<void> => {
    await baseDataProvider.update<AccountMember>("account_members", {
      id: membership.id,
      data: { status: "archived" },
      previousData: membership,
    });

    if (String(getActiveAccountId()) === String(membership.account_id)) {
      const remaining = memberships.filter((m) => m.id !== membership.id);
      setActiveAccountId(remaining.length > 0 ? remaining[0].account_id : null);
    }
  };

  if (persona === "shadchan") {
    const membership = memberships.find((m) => m.role === "shadchan");
    if (!membership) return; // no-op: no active shadchan membership
    await archiveMembership(membership);
    return;
  }

  if (persona === "single") {
    let target: { single: Single; membership: AccountMember } | undefined;
    for (const membership of memberships) {
      if (
        membership.role !== "single" &&
        !isOwningMembershipRole(membership.role)
      ) {
        continue;
      }
      const { data } = await baseDataProvider.getList<Single>("singles", {
        filter: { member_id: membership.id, status: "active" },
        pagination: { page: 1, perPage: 1 },
        sort: SORT_BY_ID,
      });
      if (data.length > 0) {
        target = { single: data[0], membership };
        break;
      }
    }
    if (!target) return; // no-op: no active single persona held

    if (!isOwningMembershipRole(target.membership.role)) {
      throw new Error("ask your household admin");
    }

    // "at least one other active persona": getMyPersonas() already reports
    // this exact single persona, so a total count of 1 means it is the
    // caller's only one.
    const personas = await getMyPersonas(baseDataProvider, getIdentity);
    if (personas.length <= 1) {
      throw new Error("cannot remove your only persona");
    }

    await baseDataProvider.update<Single>("singles", {
      id: target.single.id,
      data: { status: "archived" },
      previousData: target.single,
    });
    return;
  }

  if (persona === "parent") {
    const membership = memberships.find((m) => m.role === "parent_admin");
    if (!membership) return; // no-op: no active parent_admin membership

    const { data: householdSingles } = await baseDataProvider.getList<Single>(
      "singles",
      {
        filter: { account_id: membership.account_id, status: "active" },
        pagination: { page: 1, perPage: 10_000 },
        sort: SORT_BY_ID,
      },
    );
    const holdsSingle = householdSingles.some(
      (s) => String(s.member_id) === String(membership.id),
    );
    const otherSinglesCount = householdSingles.filter(
      (s) => String(s.member_id) !== String(membership.id),
    ).length;

    const { data: householdAdmins } =
      await baseDataProvider.getList<AccountMember>("account_members", {
        filter: {
          account_id: membership.account_id,
          status: "active",
          role: "parent_admin",
        },
        pagination: { page: 1, perPage: 10_000 },
        sort: SORT_BY_ID,
      });
    const otherAdminsCount = householdAdmins.filter(
      (m) => m.id !== membership.id,
    ).length;

    if (otherSinglesCount > 0 && otherAdminsCount === 0) {
      throw new Error(
        "cannot remove parent — no other admin manages this household's other singles",
      );
    }

    if (holdsSingle) {
      await baseDataProvider.update<AccountMember>("account_members", {
        id: membership.id,
        data: { role: "self_manager" },
        previousData: membership,
      });
      return;
    }

    await archiveMembership(membership);
    return;
  }
}

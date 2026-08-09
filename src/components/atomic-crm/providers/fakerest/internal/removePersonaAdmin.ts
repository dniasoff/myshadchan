import type { DataProvider, Identifier } from "ra-core";

import type { AccountMember, Single } from "../../../types";
import { guardPersonaRemoval } from "./accountDomainData";
import {
  activeMembershipsFor,
  SORT_BY_ID,
  type GetIdentity,
} from "./accountMemberships";

/**
 * FakeRest mirror of `public.remove_persona_admin()` (Story 13.2).
 * Every predicate below is copied from `supabase/schemas/02_functions.sql`,
 * not reinvented — keep the two in lockstep by hand.
 * Archives, never deletes: the only mutations here are `update` calls setting
 * `status`, never a `delete`.
 */

export async function removePersonaAdmin(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  targetAccountMemberId: Identifier,
  targetType: "member" | "single",
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("removePersonaAdmin requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);

  // Caller must be parent_admin in the active account
  const callerMembership = memberships.find((m) => m.role === "parent_admin");
  if (!callerMembership) {
    throw new Error("only a parent_admin may remove another person");
  }
  const accountId = callerMembership.account_id;

  // Target must be in the same account
  const targetMembership = memberships.find(
    (m) =>
      String(m.id) === String(targetAccountMemberId) &&
      m.account_id === accountId,
  );
  if (!targetMembership) {
    throw new Error(
      `target membership ${targetAccountMemberId} not found in this household`,
    );
  }

  // Cannot remove yourself via this path
  if (targetMembership.user_id === userId) {
    throw new Error("use removePersona() to remove your own persona");
  }

  // member branch: archive the target's account_members row
  if (targetType === "member") {
    if (targetMembership.status === "active") {
      // Refuse if this would orphan the account (reuse guardPersonaRemoval)
      await guardPersonaRemoval(
        baseDataProvider,
        targetMembership.id,
        accountId,
      );
      await baseDataProvider.update<AccountMember>("account_members", {
        id: targetMembership.id,
        data: { status: "archived" },
        previousData: targetMembership,
      });
    }
    return;
  }

  // single branch: archive the target's singles row (if linked to this membership)
  if (targetType === "single") {
    const { data: targetSingles } = await baseDataProvider.getList<Single>(
      "singles",
      {
        filter: {
          member_id: targetMembership.id,
          account_id: accountId,
          status: "active",
        },
        pagination: { page: 1, perPage: 1 },
        sort: SORT_BY_ID,
      },
    );

    if (targetSingles.length > 0) {
      const targetSingle = targetSingles[0];

      // Check the parent guard (cannot remove if other active singles exist and no other admin)
      const { data: householdSingles } = await baseDataProvider.getList<Single>(
        "singles",
        {
          filter: { account_id: accountId, status: "active" },
          pagination: { page: 1, perPage: 10_000 },
          sort: SORT_BY_ID,
        },
      );
      const otherSinglesCount = householdSingles.filter(
        (s) => String(s.member_id) !== String(targetMembership.id),
      ).length;

      const { data: householdAdmins } =
        await baseDataProvider.getList<AccountMember>("account_members", {
          filter: {
            account_id: accountId,
            status: "active",
            role: "parent_admin",
          },
          pagination: { page: 1, perPage: 10_000 },
          sort: SORT_BY_ID,
        });
      const otherAdminsCount = householdAdmins.filter(
        (m) => m.id !== callerMembership.id,
      ).length;

      if (otherSinglesCount > 0 && otherAdminsCount === 0) {
        throw new Error(
          "cannot remove single — no other admin manages this household's other singles",
        );
      }

      await baseDataProvider.update<Single>("singles", {
        id: targetSingle.id,
        data: { status: "archived" },
        previousData: targetSingle,
      });
    }
    return;
  }
}

export async function restorePersonaAdmin(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  targetAccountMemberId: Identifier,
  targetType: "member" | "single",
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("restorePersonaAdmin requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);

  // Caller must be parent_admin in the active account
  const callerMembership = memberships.find((m) => m.role === "parent_admin");
  if (!callerMembership) {
    throw new Error("only a parent_admin may restore a person");
  }
  const accountId = callerMembership.account_id;

  // Target must be in the same account
  const targetMembership = memberships.find(
    (m) =>
      String(m.id) === String(targetAccountMemberId) &&
      m.account_id === accountId,
  );
  if (!targetMembership) {
    throw new Error(
      `target membership ${targetAccountMemberId} not found in this household`,
    );
  }

  // member branch: restore the target's account_members row
  if (targetType === "member") {
    if (targetMembership.status === "archived") {
      await baseDataProvider.update<AccountMember>("account_members", {
        id: targetMembership.id,
        data: { status: "active" },
        previousData: targetMembership,
      });
      // Also restore any singles row linked to this membership
      const { data: archivedSingles } = await baseDataProvider.getList<Single>(
        "singles",
        {
          filter: {
            member_id: targetMembership.id,
            account_id: accountId,
            status: "archived",
          },
          pagination: { page: 1, perPage: 10_000 },
          sort: SORT_BY_ID,
        },
      );
      for (const single of archivedSingles) {
        await baseDataProvider.update<Single>("singles", {
          id: single.id,
          data: { status: "active" },
          previousData: single,
        });
      }
    }
    return;
  }

  // single branch: restore the target's singles row
  if (targetType === "single") {
    const { data: archivedSingles } = await baseDataProvider.getList<Single>(
      "singles",
      {
        filter: {
          member_id: targetMembership.id,
          account_id: accountId,
          status: "archived",
        },
        pagination: { page: 1, perPage: 1 },
        sort: SORT_BY_ID,
      },
    );

    if (archivedSingles.length > 0) {
      const targetSingle = archivedSingles[0];
      await baseDataProvider.update<Single>("singles", {
        id: targetSingle.id,
        data: { status: "active" },
        previousData: targetSingle,
      });
    }
    return;
  }
}

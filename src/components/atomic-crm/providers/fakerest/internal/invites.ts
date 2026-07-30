import type { DataProvider, Identifier } from "ra-core";

import {
  isInviteCapableRole,
  ROLE_AUTHORITY,
} from "../../commons/roleAuthority";
import type {
  Account,
  AccountMember,
  Invite,
  InvitableRole,
  Single,
} from "../../../types";
import { activeMembershipsFor, type GetIdentity } from "./accountMemberships";

/**
 * FakeRest mirrors of `public.create_invite()` / `public.revoke_invite()`
 * (Story 2.7/2.8). Every predicate below is copied from
 * `supabase/schemas/02_functions.sql` (via the shared
 * `providers/commons/roleAuthority.ts` mirror), not reinvented — the same
 * convention `./personas.ts`'s own header comment documents. Both scope to
 * the caller's CURRENT ACTIVE CONTEXT (mirroring `current_context_id()`),
 * never "any account the caller happens to hold a membership in" — a
 * caller who also holds a separate, invite-capable membership elsewhere
 * still cannot act on an invite there without first switching context to
 * it (`switchActiveContext`, `./contexts.ts`).
 */

// Fallback mirrors `activate_first_context_trigger`/`getMyContexts()`'s own
// rule: a login with any membership always has a live active context, never
// "none yet" — FakeRest has no trigger to bootstrap member_state, so the
// first membership found (by id) is treated as active until
// switchActiveContext() is called.
const resolveActiveAccountId = (
  memberships: AccountMember[],
  getActiveAccountId: () => Identifier | null,
): Identifier | null =>
  getActiveAccountId() ?? memberships[0]?.account_id ?? null;

const randomToken = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * FakeRest mirror of `public.create_invite()`. Every role/kind check below
 * is copied straight from the SQL function itself, via `ROLE_AUTHORITY`/
 * `isInviteCapableRole` — deliberately NOT `invitableRoles()`, which is a
 * narrower, UI-only mirror of the SAME rules for the Settings selector's
 * candidate list (`InvitesSection.tsx`). Story 6.1 drops `single` from that
 * selector's list, but `create_invite()` itself still accepts a
 * `single`-role call from `singles/SingleLoginInvite.tsx`'s own, different
 * entry point, gated by the same authority/kind rules as any other role —
 * routing this function's own validation through `invitableRoles()` would
 * incorrectly refuse it too.
 *
 * `targetSingleId` mirrors `p_target_single_id` (Story 6.1): required (and
 * validated — exists, unlinked, in the caller's own account) for a
 * `single`-role invite, mirroring `create_invite()`'s own two checks in the
 * same order.
 */
export async function createInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  email: string,
  role: InvitableRole,
  targetSingleId?: Identifier | null,
): Promise<Invite> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("createInvite requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  const accountId = resolveActiveAccountId(memberships, getActiveAccountId);
  const membership = memberships.find(
    (m) => String(m.account_id) === String(accountId),
  );

  if (!membership) {
    throw new Error("no active membership of the current context");
  }
  if (!isInviteCapableRole(membership.role)) {
    throw new Error(`role ${membership.role} may not send invites`);
  }
  if (ROLE_AUTHORITY[role] > ROLE_AUTHORITY[membership.role]) {
    throw new Error(`cannot invite role ${role} above your own authority`);
  }

  const { data: account } = await baseDataProvider.getOne<Account>("accounts", {
    id: membership.account_id,
  });

  if (
    account.kind === "household" &&
    role !== "parent_admin" &&
    role !== "helper" &&
    role !== "single"
  ) {
    throw new Error(
      `role ${role} is not invitable into a household-kind account`,
    );
  }
  if (account.kind === "shadchanus" && role !== "shadchan") {
    throw new Error(
      `role ${role} is not invitable into a shadchanus-kind account`,
    );
  }

  // Story 6.1 (AC-2): a single-role invite always names a target, and a
  // target is only ever valid when it exists, unlinked, in the caller's own
  // account — mirrors create_invite()'s own two checks exactly, including
  // which one runs first.
  if (role === "single" && targetSingleId == null) {
    throw new Error("a single-role invite requires a target single");
  }
  if (targetSingleId != null) {
    const { data: candidateSingles } = await baseDataProvider.getList<Single>(
      "singles",
      {
        filter: { id: targetSingleId, account_id: membership.account_id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      },
    );
    const target = candidateSingles[0];
    if (!target || target.member_id != null) {
      throw new Error(`single ${targetSingleId} not found in current account`);
    }
  }

  const now = Date.now();
  const { data: invite } = await baseDataProvider.create<Invite>("invites", {
    data: {
      email,
      account_id: membership.account_id,
      role,
      invited_by: membership.id,
      target_single_id: targetSingleId ?? null,
      status: "pending",
      token: randomToken(),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + FOURTEEN_DAYS_MS).toISOString(),
      accepted_at: null,
    },
  });
  return invite;
}

/** FakeRest mirror of `public.revoke_invite()`. */
export async function revokeInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  inviteId: Identifier,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("revokeInvite requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  const accountId = resolveActiveAccountId(memberships, getActiveAccountId);

  const { data: invite } = await baseDataProvider.getOne<Invite>("invites", {
    id: inviteId,
  });
  // Mirrors revoke_invite()'s own `where account_id = current_context_id()`
  // lookup: an invite outside the caller's active context is simply not
  // found, the same shape of invisibility RLS produces in Postgres — not a
  // distinct "you don't have permission" branch.
  if (!invite || String(invite.account_id) !== String(accountId)) {
    throw new Error(`invite ${inviteId} not found in current context`);
  }

  const membership = memberships.find(
    (m) => String(m.account_id) === String(accountId),
  );
  if (!membership || !isInviteCapableRole(membership.role)) {
    throw new Error(`role ${membership?.role} may not revoke invites`);
  }
  if (invite.status !== "pending") {
    throw new Error(
      `invite ${inviteId} is not pending (status ${invite.status})`,
    );
  }

  await baseDataProvider.update<Invite>("invites", {
    id: inviteId,
    data: { status: "revoked" },
    previousData: invite,
  });
}

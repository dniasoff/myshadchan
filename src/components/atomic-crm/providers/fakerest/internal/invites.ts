import type { DataProvider, Identifier } from "ra-core";

import {
  isInviteCapableRole,
  invitableRoles,
} from "../../commons/roleAuthority";
import type {
  Account,
  AccountMember,
  Invite,
  InvitableRole,
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

/** FakeRest mirror of `public.create_invite()`. */
export async function createInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  email: string,
  role: InvitableRole,
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

  const { data: account } = await baseDataProvider.getOne<Account>("accounts", {
    id: membership.account_id,
  });

  const allowed = invitableRoles(membership.role, account.kind);
  if (!allowed.includes(role)) {
    throw new Error(
      account.kind === "household"
        ? `role ${role} is not invitable into a household-kind account`
        : `role ${role} is not invitable into a shadchanus-kind account`,
    );
  }

  const now = Date.now();
  const { data: invite } = await baseDataProvider.create<Invite>("invites", {
    data: {
      email,
      account_id: membership.account_id,
      role,
      invited_by: membership.id,
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

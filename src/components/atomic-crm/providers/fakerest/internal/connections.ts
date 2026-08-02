import type { DataProvider, Identifier } from "ra-core";

import type {
  Account,
  Connection,
  ConnectionInvite,
  ConnectionInvitePreview,
  Shadchan,
} from "../../../types";
import {
  resolveContextMembership,
  type GetIdentity,
} from "./accountMemberships";

/**
 * FakeRest mirrors of the five consent-workflow functions Story 8.2 adds to
 * `02_functions.sql` (`create_connection_invite`/`revoke_connection_invite`/
 * `preview_connection_invite`/`accept_connection_invite`/`end_connection`).
 * Every predicate below is copied from the SQL functions' own validation, in
 * the same order — the same convention `./invites.ts`/`./threads.ts` already
 * establish for their own SQL counterparts. Unlike `getInvitePreview`/
 * `acceptInvite` (2.7's stub-in-demo pair, `dataProvider.ts`'s own comment
 * explains why), this flow is fully exercised here: accepting a connection
 * invite needs only an ALREADY-authenticated, opposite-kind active context —
 * no OTP/signup step FakeRest has never emulated — so the demo build can run
 * the real guard rails end to end.
 *
 * `endConnection()` and `revokeConnectionInvite()` require the caller's
 * ACTIVE CONTEXT (`membership.account_id`, resolved from
 * `getActiveAccountId()`) to be the party / the inviter — this was ahead of
 * `02_functions.sql`'s own SQL for one review cycle (review finding F5),
 * which briefly accepted ANY active membership of the party instead of
 * requiring it be the caller's current one. The SQL now matches this file,
 * not the other way around: see `end_connection()`'s and
 * `revoke_connection_invite()`'s own comments in `02_functions.sql`.
 */

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const randomToken = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** FakeRest mirror of `public.create_connection_invite()`. */
export async function createConnectionInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
): Promise<string> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("createConnectionInvite requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error(
      "createConnectionInvite requires an active membership of the current context",
    );
  }

  const { data: account } = await baseDataProvider.getOne<Account>("accounts", {
    id: membership.account_id,
  });

  const token = randomToken();
  const now = Date.now();
  // FakeRest stores the token itself under `token_hash` — this in-memory
  // store is never read by anyone but this same process, so there is no
  // real hashing layer to mirror (unlike the SQL function, which never
  // persists the raw token anywhere — see 01_tables.sql's own comment on
  // `connection_invites`).
  await baseDataProvider.create<ConnectionInvite>("connection_invites", {
    data: {
      inviter_account_id: membership.account_id,
      inviter_kind: account.kind,
      token_hash: token,
      status: "pending",
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + SEVEN_DAYS_MS).toISOString(),
      accepted_by_account_id: null,
      accepted_at: null,
      revoked_at: null,
    },
  });
  return token;
}

/** FakeRest mirror of `public.revoke_connection_invite()`. */
export async function revokeConnectionInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  inviteId: Identifier,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("revokeConnectionInvite requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error(
      "revokeConnectionInvite requires an active membership of the current context",
    );
  }

  const { data: invite } = await baseDataProvider.getOne<ConnectionInvite>(
    "connection_invites",
    { id: inviteId },
  );
  // Mirrors revoke_connection_invite()'s own scope: an invite outside the
  // caller's inviting account is simply not found, the same shape RLS
  // produces in Postgres — not a distinct "not yours" error.
  if (
    !invite ||
    String(invite.inviter_account_id) !== String(membership.account_id)
  ) {
    throw new Error(`connection invite ${inviteId} not found`);
  }
  if (invite.status !== "pending") {
    throw new Error(
      `connection invite ${inviteId} is not pending (status ${invite.status})`,
    );
  }

  await baseDataProvider.update<ConnectionInvite>("connection_invites", {
    id: inviteId,
    data: { status: "revoked", revoked_at: new Date().toISOString() },
    previousData: invite,
  });
}

/**
 * FakeRest mirror of `public.preview_connection_invite()` — read-only,
 * requires only a signed-in caller (any context; the real grant is
 * authenticated-only, not scoped to a particular account or kind). Resolves
 * to `null` for an unknown, expired or already-consumed token, exactly like
 * the real function's empty result set — never an error, so an invite link
 * is not an enumeration oracle.
 */
export async function previewConnectionInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  token: string,
): Promise<ConnectionInvitePreview | null> {
  const identity = await getIdentity();
  if (identity == null) {
    return null;
  }

  const { data: invites } = await baseDataProvider.getList<ConnectionInvite>(
    "connection_invites",
    { filter: { token_hash: token }, pagination: PAGE_ONE, sort: SORT_BY_ID },
  );
  const invite = invites[0];
  if (!invite) {
    return null;
  }
  const isExpired = new Date(invite.expires_at).getTime() <= Date.now();
  if (invite.status !== "pending" || isExpired) {
    return null;
  }

  const { data: inviterAccount } = await baseDataProvider.getOne<Account>(
    "accounts",
    { id: invite.inviter_account_id },
  );

  return {
    inviter_name: inviterAccount.name,
    inviter_kind: invite.inviter_kind,
    status: invite.status,
    expires_at: invite.expires_at,
  };
}

/**
 * FakeRest mirror of `public.accept_connection_invite()`. Steps mirror the
 * SQL function's own numbered spec (02_functions.sql's comment on it) in
 * the same order: resolve the invite (pending, unexpired), require an
 * opposite-kind active context, resolve which id is which side, create the
 * connection, seed the household's own book entry, then burn the invite.
 */
export async function acceptConnectionInvite(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  token: string,
): Promise<Connection> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("acceptConnectionInvite requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error(
      "acceptConnectionInvite requires an active membership of the current context",
    );
  }

  const { data: invites } = await baseDataProvider.getList<ConnectionInvite>(
    "connection_invites",
    { filter: { token_hash: token }, pagination: PAGE_ONE, sort: SORT_BY_ID },
  );
  const invite = invites[0];
  const isExpired =
    invite != null && new Date(invite.expires_at).getTime() <= Date.now();
  if (!invite || invite.status !== "pending" || isExpired) {
    throw new Error(
      "This connection invite is invalid, expired, or has already been used.",
    );
  }

  const { data: acceptorAccount } = await baseDataProvider.getOne<Account>(
    "accounts",
    { id: membership.account_id },
  );
  if (acceptorAccount.kind === invite.inviter_kind) {
    throw new Error(
      "a connection links a household and a shadchanus context, not two of the same kind",
    );
  }

  const householdAccountId =
    acceptorAccount.kind === "household"
      ? membership.account_id
      : invite.inviter_account_id;
  const shadchanusAccountId =
    acceptorAccount.kind === "shadchanus"
      ? membership.account_id
      : invite.inviter_account_id;

  // Story 8.5 (AC-2): the household side's own name, snapshotted onto the
  // connection row — the mirror-image of `shadchanusAccount.name` below,
  // read once more here rather than reused because `acceptorAccount` is
  // only the household's own row when THIS caller is the household side
  // (see `household_account_name`'s own comment in types.ts).
  const householdAccount =
    acceptorAccount.kind === "household"
      ? acceptorAccount
      : (
          await baseDataProvider.getOne<Account>("accounts", {
            id: householdAccountId,
          })
        ).data;

  const now = new Date().toISOString();
  const { data: connection } = await baseDataProvider.create<Connection>(
    "connections",
    {
      data: {
        household_account_id: householdAccountId,
        shadchanus_account_id: shadchanusAccountId,
        status: "accepted",
        ended_at: null,
        proposed_by_account_id: invite.inviter_account_id,
        accepted_at: now,
        ended_by_account_id: null,
        created_at: now,
        household_account_name: householdAccount.name,
      },
    },
  );

  const { data: shadchanusAccount } = await baseDataProvider.getOne<Account>(
    "accounts",
    { id: shadchanusAccountId },
  );
  // What makes the shadchan appear in the household's own book (Shadchan
  // 360, Story 5.9) from the moment of connecting — mirrors the SQL
  // function's own step 5 exactly.
  await baseDataProvider.create<Shadchan>("shadchanim", {
    data: {
      account_id: householdAccountId,
      name: shadchanusAccount.name,
      connection_id: connection.id,
      created_at: now,
    },
  });

  await baseDataProvider.update<ConnectionInvite>("connection_invites", {
    id: invite.id,
    data: {
      status: "accepted",
      accepted_by_account_id: membership.account_id,
      accepted_at: now,
    },
    previousData: invite,
  });

  return connection;
}

/** FakeRest mirror of `public.end_connection()`. */
export async function endConnection(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  connectionId: Identifier,
): Promise<Connection> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("endConnection requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error(
      "endConnection requires an active membership of the current context",
    );
  }

  const { data: connection } = await baseDataProvider.getOne<Connection>(
    "connections",
    { id: connectionId },
  );
  const isEitherSide =
    connection != null &&
    (String(connection.household_account_id) ===
      String(membership.account_id) ||
      String(connection.shadchanus_account_id) ===
        String(membership.account_id));
  if (!connection || !isEitherSide) {
    throw new Error(`connection ${connectionId} not found`);
  }
  if (connection.status === "ended") {
    throw new Error(`connection ${connectionId} has already ended`);
  }

  const { data: updated } = await baseDataProvider.update<Connection>(
    "connections",
    {
      id: connectionId,
      data: {
        status: "ended",
        ended_at: new Date().toISOString(),
        ended_by_account_id: membership.account_id,
      },
      previousData: connection,
    },
  );
  return updated;
}

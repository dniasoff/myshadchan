import type { DataProvider, Identifier } from "ra-core";
import type {
  ChildGrant,
  ChildGrantAccessLevel,
  ChildGrantPreview,
} from "../../../types";

function generateToken(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Deterministic, one-way-in-spirit derivation of a stand-in "hash" from the
// plaintext token — NOT the real hashing algorithm the Supabase RPCs use
// server-side (irrelevant here since FakeRest never leaves the browser).
// Bugfix: this used to be `generateTokenHash()`, a SECOND call to a random
// generator unrelated to the token just minted — so `previewChildGrant`/
// `acceptChildGrant` filtered on a value that could never match what
// `createChildGrant` had stored, and every lookup silently returned "not
// found". Deterministic hashing is what makes the token round-trip at all.
function hashToken(token: string): string {
  return `hash:${token}`;
}

export async function createChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  singleId: Identifier,
  _email: string,
  accessLevel: ChildGrantAccessLevel,
): Promise<string> {
  const activeAccountId = getActiveAccountId();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 7 days

  const { data: _grant } = await baseDataProvider.create<ChildGrant>(
    "child_grants",
    {
      data: {
        proposer_account_id: activeAccountId,
        target_single_id: singleId,
        token_hash: tokenHash,
        status: "pending",
        access_level: accessLevel,
        expires_at: expiresAt,
        grantee_account_id: null,
        accepted_at: null,
        revoked_at: null,
        severed_by_account_id: null,
        severed_at: null,
        copy_on_sever: true,
      },
    },
  );

  return token;
}

export async function revokeChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  id: Identifier,
): Promise<void> {
  const activeAccountId = getActiveAccountId();

  const { data: grant } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id },
  );
  if (grant.proposer_account_id !== activeAccountId) {
    throw new Error("Only the proposer may revoke a grant");
  }
  if (grant.status !== "pending") {
    throw new Error("Only pending grants may be revoked");
  }

  await baseDataProvider.update("child_grants", {
    id,
    data: { status: "revoked", revoked_at: new Date().toISOString() },
    previousData: grant,
  });
}

export async function previewChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  token: string,
): Promise<ChildGrantPreview | null> {
  const tokenHash = hashToken(token);

  const { data: grants } = await baseDataProvider.getList<ChildGrant>(
    "child_grants",
    {
      filter: { token_hash: tokenHash },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "created_at", order: "DESC" },
    },
  );

  if (grants.length === 0) return null;
  const grant = grants[0];

  // Check status
  if (
    grant.status === "revoked" ||
    grant.status === "expired" ||
    grant.status === "severed"
  ) {
    return null;
  }
  if (new Date(grant.expires_at).getTime() <= Date.now()) {
    return null;
  }

  // Get proposer name
  const { data: proposerAccount } = await baseDataProvider.getOne("accounts", {
    id: grant.proposer_account_id,
  });
  const proposerName = proposerAccount?.name ?? "Unknown household";

  // Get single name
  const { data: single } = await baseDataProvider.getOne("singles", {
    id: grant.target_single_id,
  });

  return {
    proposer_name: proposerName,
    target_single_name_en: single?.first_name_en ?? null,
    target_single_name_he: single?.first_name_he ?? null,
    status: grant.status,
    access_level: grant.access_level,
    expires_at: grant.expires_at,
  };
}

export async function acceptChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  token: string,
): Promise<ChildGrant> {
  const activeAccountId = getActiveAccountId();
  const tokenHash = hashToken(token);

  const { data: grants } = await baseDataProvider.getList<ChildGrant>(
    "child_grants",
    {
      filter: { token_hash: tokenHash },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "created_at", order: "DESC" },
    },
  );

  if (grants.length === 0) {
    throw new Error("Grant not found");
  }
  const grant = grants[0];

  if (grant.status !== "pending") {
    throw new Error("Grant is not pending");
  }
  if (new Date(grant.expires_at).getTime() <= Date.now()) {
    throw new Error("Grant has expired");
  }

  // Verify the grantee is a member of the accepting account
  // In FakeRest, we'll just accept if the account matches
  if (
    grant.grantee_account_id !== null &&
    grant.grantee_account_id !== activeAccountId
  ) {
    throw new Error("This grant is not for your household");
  }

  await baseDataProvider.update("child_grants", {
    id: grant.id,
    data: {
      status: "accepted",
      grantee_account_id: activeAccountId,
      accepted_at: new Date().toISOString(),
    },
    previousData: grant,
  });

  const { data: updated } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id: grant.id },
  );
  return updated;
}

export async function severChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  id: Identifier,
): Promise<ChildGrant> {
  const activeAccountId = getActiveAccountId();

  const { data: grant } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id },
  );
  if (
    grant.proposer_account_id !== activeAccountId &&
    grant.grantee_account_id !== activeAccountId
  ) {
    throw new Error("Only the proposer or grantee may sever a grant");
  }
  if (grant.status !== "accepted") {
    throw new Error("Only accepted grants may be severed");
  }

  await baseDataProvider.update("child_grants", {
    id,
    data: {
      status: "severed",
      severed_by_account_id: activeAccountId,
      severed_at: new Date().toISOString(),
    },
    previousData: grant,
  });

  const { data: updated } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id },
  );
  return updated;
}

export async function regrantChildGrant(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  id: Identifier,
): Promise<string> {
  const activeAccountId = getActiveAccountId();

  const { data: oldGrant } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id },
  );
  if (
    oldGrant.proposer_account_id !== activeAccountId &&
    oldGrant.grantee_account_id !== activeAccountId
  ) {
    throw new Error("Only the proposer or grantee may re-grant");
  }
  if (!["severed", "revoked", "expired"].includes(oldGrant.status)) {
    throw new Error("Only ended grants may be re-granted");
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await baseDataProvider.create<ChildGrant>("child_grants", {
    data: {
      proposer_account_id: activeAccountId,
      target_single_id: oldGrant.target_single_id,
      token_hash: tokenHash,
      status: "pending",
      // Carry the previous tier forward — a re-grant re-opens the same
      // relationship, not a reset to the "read" default.
      access_level: oldGrant.access_level,
      expires_at: expiresAt,
      grantee_account_id: null,
      accepted_at: null,
      revoked_at: null,
      severed_by_account_id: null,
      severed_at: null,
      copy_on_sever: true,
    },
  });

  return token;
}

// New RPC: lets the proposer change an already-accepted grant's tier
// without severing and re-granting. Mirrors the other lifecycle actions'
// "load, check who may act, write" shape.
export async function updateChildGrantAccess(
  baseDataProvider: DataProvider,
  _getIdentity: () => Promise<unknown>,
  getActiveAccountId: () => number,
  id: Identifier,
  accessLevel: ChildGrantAccessLevel,
): Promise<void> {
  const activeAccountId = getActiveAccountId();

  const { data: grant } = await baseDataProvider.getOne<ChildGrant>(
    "child_grants",
    { id },
  );
  if (grant.proposer_account_id !== activeAccountId) {
    throw new Error("Only the proposer may change a grant's access level");
  }
  if (grant.status !== "accepted") {
    throw new Error("Only accepted grants may have their access level changed");
  }

  await baseDataProvider.update("child_grants", {
    id,
    data: { access_level: accessLevel },
    previousData: grant,
  });
}

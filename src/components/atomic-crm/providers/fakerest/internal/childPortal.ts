import type { DataProvider, Identifier } from "ra-core";

import type {
  Child,
  ChildPortalData,
  ChildPortalSuggestion,
  ChildPortalToken,
  Shidduch,
} from "../../../types";
import { isChildVisibleState } from "../../../shidduchim/pipelineStates";
import { childPortalStatusLabel } from "../../../portal/childPortalStatus";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;

/**
 * FakeRest mirror of the E7 read-only child portal. It reproduces the database's
 * guarantees so demo mode behaves like production and teaches the right thing:
 *   - the token is server-generated (here, a CSPRNG hex string), never chosen;
 *   - get_child_portal returns ONLY shared + child-visible-state suggestions,
 *     scoped to the token's own child, with only child-safe fields;
 *   - an unknown or revoked token yields null.
 * There is no RLS here, so these functions carry the scoping the database's
 * SECURITY DEFINER RPC and policies enforce on the real backend.
 */

const generateToken = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const listTokensForChild = async (
  base: DataProvider,
  childId: Identifier,
): Promise<ChildPortalToken[]> => {
  const { data } = await base.getList<ChildPortalToken>("child_portal_tokens", {
    filter: { child_id: childId },
    pagination: PAGE_ALL,
    sort: { field: "created_at", order: "DESC" },
  });
  return data;
};

export const getActiveChildPortalToken = async (
  base: DataProvider,
  childId: Identifier,
): Promise<ChildPortalToken | null> => {
  const tokens = await listTokensForChild(base, childId);
  return tokens.find((entry) => entry.revoked_at == null) ?? null;
};

export const mintChildPortalToken = async (
  base: DataProvider,
  childId: Identifier,
): Promise<ChildPortalToken> => {
  const { data: child } = await base.getOne<Child>("children", { id: childId });
  const { data } = await base.create<ChildPortalToken>("child_portal_tokens", {
    data: {
      account_id: child.account_id,
      child_id: childId,
      token: generateToken(),
      revoked_at: null,
      created_at: new Date().toISOString(),
    } as Partial<ChildPortalToken>,
  });
  return data;
};

export const revokeChildPortalToken = async (
  base: DataProvider,
  id: Identifier,
): Promise<void> => {
  await base.update("child_portal_tokens", {
    id,
    data: { revoked_at: new Date().toISOString() },
    previousData: { id },
  });
};

export const getChildPortal = async (
  base: DataProvider,
  token: string,
): Promise<ChildPortalData | null> => {
  if (!token || token.length < 24) {
    return null;
  }

  const { data: tokens } = await base.getList<ChildPortalToken>(
    "child_portal_tokens",
    {
      filter: { token },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const record = tokens[0];
  if (!record || record.revoked_at != null) {
    return null;
  }

  const { data: child } = await base
    .getOne<Child>("children", { id: record.child_id })
    .catch(() => ({ data: null as Child | null }));
  if (!child || child.account_id !== record.account_id) {
    return null;
  }

  const { data: shidduchim } = await base.getList<Shidduch>("shidduchim", {
    filter: { child_id: record.child_id },
    pagination: PAGE_ALL,
    sort: { field: "redt_date", order: "DESC" },
  });

  const suggestions: ChildPortalSuggestion[] = shidduchim
    .filter(
      (s) =>
        s.account_id === record.account_id &&
        s.visibility === "shared" &&
        isChildVisibleState(s.pipeline_state),
    )
    .map((s) => ({
      name_en: s.name_en ?? null,
      name_he: s.name_he ?? null,
      redt_date: s.redt_date,
      status_label: childPortalStatusLabel(s.pipeline_state),
    }));

  return {
    child: {
      first_name_en: child.first_name_en ?? null,
      first_name_he: child.first_name_he ?? null,
    },
    suggestions,
  };
};

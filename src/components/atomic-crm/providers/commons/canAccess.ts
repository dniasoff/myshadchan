import type { MemberRole } from "../../types";
import { canManageMembers } from "./roleAuthority";

// FIXME: This should be exported from the ra-core package
type CanAccessParams<
  RecordType extends Record<string, any> = Record<string, any>,
> = {
  action: string;
  resource: string;
  record?: RecordType;
};

/**
 * The client-side gate behind `useCanAccess` / `<CanAccess>`
 * (`layout/TopBar.tsx`, `admin/app-sidebar.tsx`). Story 3.4, AD-2 —
 * authorization derives from the caller's role in the active context,
 * never a hardcoded per-login flag. Exactly three rules, in order:
 *
 * 1. `role === undefined` -> `false` — fails closed, for every resource.
 *    A role only fails to resolve when there is no live active membership
 *    at all (or the resolving RPC/query errored); either way, nothing is
 *    granted.
 * 2. `resource === "members"` -> `canManageMembers(role)`.
 * 3. every other resource -> `true`.
 *
 * `role` is resolved by both authProviders from the active context
 * (`pickActiveRole`, `providers/commons/roleAuthority.ts`) — never from
 * `members.administrator`, which is a global per-login flag unrelated to
 * `account_members.role` (AD-2).
 */
export const canAccess = <
  RecordType extends Record<string, any> = Record<string, any>,
>(
  role: MemberRole | undefined,
  params: CanAccessParams<RecordType>,
): boolean => {
  if (role === undefined) {
    return false;
  }

  if (params.resource === "members") {
    return canManageMembers(role);
  }

  return true;
};

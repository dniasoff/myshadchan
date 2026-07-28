import type { InvitableRole, MemberRole } from "../../types";

/**
 * TypeScript mirror of `public.role_authority()` / `public.is_invite_capable_role()`
 * (supabase/schemas/02_functions.sql, Story 2.7/2.8's shared invite-authority
 * helpers). Keep the two in lockstep by hand — there is no shared source
 * across the Postgres/TypeScript boundary, the same convention
 * `providers/fakerest/internal/personas.ts`'s own header comment documents
 * for its SQL mirrors.
 *
 * Two consumers: `settings/InvitesSection.tsx` (AC-1's role selector options
 * — UX only, `create_invite()`'s own server-side check is the actual
 * enforcement) and the FakeRest emulation of `create_invite()`/
 * `revoke_invite()` (`providers/fakerest/internal/invites.ts`), so the
 * authority predicate is written once, not duplicated a third time.
 */

/** Mirrors `public.role_authority()`. `self_manager` (2) sits between
 * `parent_admin` (3) and the three authority-1 roles: a self-managing
 * single may invite a `helper` or another `single` into their own
 * household, but never a `parent_admin`. */
export const ROLE_AUTHORITY: Record<MemberRole, number> = {
  parent_admin: 3,
  self_manager: 2,
  helper: 1,
  single: 1,
  shadchan: 1,
};

/** Mirrors `public.is_invite_capable_role()` — the roles an invite may ever
 * be sent FROM. Deliberately BROADER than 2.2's owning-role helper
 * (`is_owning_membership_role()`, parent_admin/self_manager only): a
 * shadchan can invite into their shadchanus but never owns a `singles` row
 * — do not merge the two predicates. */
export const isInviteCapableRole = (role: MemberRole): boolean =>
  role === "parent_admin" || role === "self_manager" || role === "shadchan";

/**
 * The role options AC-1's selector shows a given caller — a client-side
 * mirror of `create_invite()`'s own three checks (invite-capable sender
 * role, `role_authority()` ceiling, account-kind match). Returns `[]` for a
 * non-invite-capable caller (e.g. a `helper`), so the form can render no
 * options at all rather than an error after submitting.
 */
export const invitableRoles = (
  callerRole: MemberRole,
  accountKind: "household" | "shadchanus",
): InvitableRole[] => {
  if (!isInviteCapableRole(callerRole)) return [];

  const candidates: InvitableRole[] =
    accountKind === "household"
      ? ["parent_admin", "helper", "single"]
      : ["shadchan"];

  return candidates.filter(
    (role) => ROLE_AUTHORITY[role] <= ROLE_AUTHORITY[callerRole],
  );
};

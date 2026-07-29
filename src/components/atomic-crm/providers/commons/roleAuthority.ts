import type { InvitableRole, MemberRole, MyContext } from "../../types";

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

/**
 * The active-context selector (Story 3.4). Three consumers, all through
 * `pickActiveRole`: `entity360/useViewerRole.ts` (the one role source
 * inside `entity360/`) and both authProviders' `canAccess`
 * (`providers/supabase/authProvider.ts`, `providers/fakerest/authProvider.ts`)
 * — so the React-tree tab-visibility check and the `useCanAccess` /
 * `<CanAccess>` seam can never diverge on what "active" means.
 * `pickActiveContext` alone additionally replaces `settings/InvitesSection
 * .tsx`'s own hand-rolled `find(c => c.is_active)`.
 *
 * Deliberately NOT `layout/ContextSwitcher.tsx`'s `?? contexts[0]` display
 * fallback: a login with no active membership has no role/context here and
 * must fail closed, never borrow the first row (that switcher fallback only
 * ever names a pill — it is not an authority decision).
 */
export const pickActiveContext = (
  contexts: MyContext[] | undefined,
): MyContext | undefined => contexts?.find((context) => context.is_active);

export const pickActiveRole = (
  contexts: MyContext[] | undefined,
): MemberRole | undefined => pickActiveContext(contexts)?.role;

/**
 * The roles allowed to manage `public.members` (Story 3.4 AC 8, AD-2 —
 * authorization derives from the active-context role, never a hardcoded
 * per-login flag). Deliberately its own, separately named predicate: NOT
 * aliased to `isInviteCapableRole` even though the two sets coincide today
 * (this file's own convention above — distinct questions keep distinct
 * predicates), and NOT `is_owning_membership_role()`
 * (`supabase/schemas/02_functions.sql`, `parent_admin`/`self_manager` only
 * — a household-persona predicate): a `shadchan` needs to manage their own
 * shadchanus context's members too (Epic 8.5), and a shadchanus context
 * holds no household persona at all.
 */
export const canManageMembers = (role: MemberRole): boolean =>
  role === "parent_admin" || role === "self_manager" || role === "shadchan";

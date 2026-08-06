import type { TranslateFunction } from "ra-core";

import type { MemberRole } from "../types";

/**
 * Reuses the four `MemberRole` labels the Settings invites section already
 * carries (`crm.settings.invites_role_*`) rather than declaring a second,
 * parallel role vocabulary just for the assignee picker/chip — DRY per
 * `.claude/rules/coding-style.md`. `self_manager` has no invites-section
 * counterpart (invites never target it — see `InvitableRole` in types.ts),
 * so it falls back to an English-only label via `translate()`'s own `_:`
 * convention rather than adding a ninth catalogue entry for a role a
 * household's assignee picker can show but never explicitly invites.
 */
const ROLE_LABEL_KEY: Partial<Record<MemberRole, string>> = {
  parent_admin: "crm.settings.invites_role_parent_admin",
  helper: "crm.settings.invites_role_helper",
  single: "crm.settings.invites_role_single",
  shadchan: "crm.settings.invites_role_shadchan",
};

/** The role label shown beside a member's name in the assignee chip/picker. */
export function assigneeRoleLabel(
  role: MemberRole,
  translate: TranslateFunction,
): string {
  const key = ROLE_LABEL_KEY[role];
  if (key) return translate(key, { _: role });
  return translate("crm.tasks.assignee.role_self_manager", {
    _: "Self-managed",
  });
}

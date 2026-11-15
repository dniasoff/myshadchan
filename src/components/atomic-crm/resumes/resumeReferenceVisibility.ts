import type { MemberRole } from "../types";

export const canViewResumeReferences = (
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean => !isRolePending && role != null && role !== "single";

/** The deployed re-read route accepts only the two manager roles. Keep the
 * UI fail-closed so a helper/shadchan cannot be offered an action the server
 * will refuse, while single, pending and undefined roles see no control. */
export const canRereadResume = (
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean =>
  !isRolePending && (role === "parent_admin" || role === "self_manager");

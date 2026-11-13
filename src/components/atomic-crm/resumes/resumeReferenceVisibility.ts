import type { MemberRole } from "../types";

export const canViewResumeReferences = (
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean => !isRolePending && role != null && role !== "single";

import type { MemberRole } from "../../types";

export function canViewChildDocuments(
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean {
  return (
    !isRolePending &&
    (role === "parent_admin" ||
      role === "self_manager" ||
      role === "helper" ||
      role === "shadchan")
  );
}

/** Native file sharing is intentionally limited to touch devices. Desktop
 * users get explicit Download / Email / WhatsApp choices instead, because
 * those channels require the user to attach the file themselves. */
export function canUseNativeFileShare(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  const isTouchDevice =
    navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  return (
    isTouchDevice &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

import type { MemberRole } from "../types";

/**
 * Pure allow-list check behind `EntityTabDescriptor.visibleTo` (Epic 3 API
 * contract §6). No React import, no hook: `EntityShow` calls this
 * synchronously while assembling the tab array, before `Entity360Tabs` ever
 * mounts, so a denied tab's `render` is never invoked and its label never
 * reaches the DOM.
 *
 * Truth table, checked in exactly this order:
 *  1. `visibleTo` absent  -> `true`  (unrestricted; independent of `role`,
 *     including `role === undefined` — an unrestricted tab is not a
 *     restricted one).
 *  2. `role` absent       -> `false` (fails closed on a restricted tab).
 *  3. otherwise           -> `visibleTo.includes(role)`.
 * An empty `visibleTo` allow-list falls out of rule 3 as `false` for every
 * role — no separate case needed.
 */
export function hasVisibility(
  visibleTo: MemberRole[] | undefined,
  role: MemberRole | undefined,
): boolean {
  if (visibleTo === undefined) {
    return true;
  }
  if (role === undefined) {
    return false;
  }
  return visibleTo.includes(role);
}

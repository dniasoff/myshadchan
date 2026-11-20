import type { Identifier } from "ra-core";

export const SHADCHAN_ACTION_UNDO_MS = 10_000;

export const canManageShadchanLifecycle = (role: unknown): boolean =>
  role === "parent_admin" || role === "self_manager";

export type ShadchanLifecycleAction = {
  id: Identifier;
  name: string;
  deadline: number;
};

// The server owns the lifecycle window. Keep its display-only Undo marker in
// memory so names and identifiers never enter browser storage or URLs.
let pendingShadchanAction: ShadchanLifecycleAction | null = null;

export const rememberPendingShadchanAction = (
  action: ShadchanLifecycleAction,
): boolean => {
  pendingShadchanAction = action;
  return true;
};

export const readPendingShadchanAction = (
  state?: unknown,
): ShadchanLifecycleAction | null => {
  const routeAction =
    state && typeof state === "object" && "shadchanLifecycle" in state
      ? (state as { shadchanLifecycle?: unknown }).shadchanLifecycle
      : undefined;
  if (routeAction && typeof routeAction === "object") {
    const candidate = routeAction as Partial<ShadchanLifecycleAction>;
    if (
      candidate.id != null &&
      typeof candidate.name === "string" &&
      typeof candidate.deadline === "number"
    ) {
      const action = candidate as ShadchanLifecycleAction;
      rememberPendingShadchanAction(action);
      return action;
    }
  }
  return pendingShadchanAction;
};

export const clearPendingShadchanAction = (): void => {
  pendingShadchanAction = null;
};

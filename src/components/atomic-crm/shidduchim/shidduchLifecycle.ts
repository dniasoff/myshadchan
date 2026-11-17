import type { Identifier } from "ra-core";

export const SHIDDUCH_ACTION_UNDO_MS = 10_000;

export type ShidduchLifecycleAction = {
  kind: "archive" | "delete";
  id: Identifier;
  name: string;
  deadline: number;
};

export type ShidduchStoragePurgeResult = {
  purgePending: boolean;
};

export type ShidduchReadState = {
  inProgress: boolean;
};

export const SHIDDUCH_DELETE_MARKER_KEY = "myshadchan:pending-shidduch-delete";

type PendingDeleteMarker = {
  id: Identifier;
  deadline: number;
};

export const rememberPendingShidduchDelete = (
  marker: PendingDeleteMarker,
): void => {
  try {
    sessionStorage.setItem(SHIDDUCH_DELETE_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // A blocked or unavailable sessionStorage only loses the delete marker;
    // the suggestion remains archived and recoverable.
  }
};

export const readPendingShidduchDelete = (): PendingDeleteMarker | null => {
  try {
    const raw = sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingDeleteMarker>;
    if (value.id == null || typeof value.deadline !== "number") return null;
    return { id: value.id, deadline: value.deadline };
  } catch {
    return null;
  }
};

export const clearPendingShidduchDelete = (): void => {
  try {
    sessionStorage.removeItem(SHIDDUCH_DELETE_MARKER_KEY);
  } catch {
    // Nothing to do: the persisted row remains archived and safe.
  }
};

export const getPendingShidduchAction = (state: unknown) => {
  const value = (state as { shidduchLifecycle?: unknown } | null)
    ?.shidduchLifecycle;
  if (!value || typeof value !== "object") return null;
  const action = value as Partial<ShidduchLifecycleAction>;
  if (
    (action.kind !== "archive" && action.kind !== "delete") ||
    action.id == null ||
    typeof action.name !== "string" ||
    typeof action.deadline !== "number"
  ) {
    return null;
  }
  return action as ShidduchLifecycleAction;
};

export const canManageShidduchLifecycle = (role: unknown): boolean =>
  role === "parent_admin" || role === "self_manager";

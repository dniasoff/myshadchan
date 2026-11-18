import type { Identifier } from "ra-core";

export const SHIDDUCH_ACTION_UNDO_MS = 10_000;

export type ShidduchLifecycleOrigin = "page" | "row";

export type ShidduchLifecycleAction = {
  kind: "archive" | "delete";
  id: Identifier;
  name: string;
  deadline: number;
  origin: ShidduchLifecycleOrigin;
  retryRequired?: boolean;
};

export type ShidduchStoragePurgeResult = {
  purgePending: boolean;
};

export type ShidduchReadState = {
  inProgress: boolean;
};

export const SHIDDUCH_DELETE_MARKER_KEY = "myshadchan:pending-shidduch-delete";

export type PendingShidduchMarker = {
  id: Identifier;
  kind: "archive" | "delete";
  deadline: number;
  origin: ShidduchLifecycleOrigin;
  retryRequired?: boolean;
};

type MarkerCollection = Record<string, PendingShidduchMarker>;

type PendingShidduchMarkerInput = Omit<PendingShidduchMarker, "origin"> & {
  origin?: ShidduchLifecycleOrigin;
};

const readMarkerCollection = (): MarkerCollection => {
  try {
    const raw = sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(
        ([key, value]) => {
          if (!value || typeof value !== "object") return [];
          const marker = value as Partial<PendingShidduchMarker>;
          if (
            marker.id == null ||
            (marker.kind !== "archive" && marker.kind !== "delete") ||
            typeof marker.deadline !== "number" ||
            (marker.retryRequired !== undefined &&
              typeof marker.retryRequired !== "boolean")
          ) {
            return [];
          }
          return [
            [
              key,
              {
                ...marker,
                id: marker.id,
                // Markers written before origin was introduced came from the
                // suggestion page, whose Undo focus behavior must remain
                // unchanged.
                origin: marker.origin === "row" ? "row" : ("page" as const),
              } as PendingShidduchMarker,
            ],
          ];
        },
      ),
    );
  } catch {
    return {};
  }
};

const writeMarkerCollection = (markers: MarkerCollection): boolean => {
  try {
    if (Object.keys(markers).length === 0) {
      sessionStorage.removeItem(SHIDDUCH_DELETE_MARKER_KEY);
    } else {
      sessionStorage.setItem(
        SHIDDUCH_DELETE_MARKER_KEY,
        JSON.stringify(markers),
      );
    }
    return true;
  } catch {
    return false;
  }
};

export const rememberPendingShidduchAction = (
  marker: PendingShidduchMarkerInput,
): boolean => {
  const normalizedMarker: PendingShidduchMarker = {
    ...marker,
    origin: marker.origin ?? "page",
  };
  const markers = readMarkerCollection();
  const existing = markers[String(normalizedMarker.id)];
  if (
    existing &&
    existing.kind === normalizedMarker.kind &&
    existing.deadline === normalizedMarker.deadline &&
    existing.origin === normalizedMarker.origin &&
    Boolean(existing.retryRequired) === Boolean(normalizedMarker.retryRequired)
  ) {
    return true;
  }
  markers[String(normalizedMarker.id)] = normalizedMarker;
  return writeMarkerCollection(markers);
};

export const readPendingShidduchActions = (): PendingShidduchMarker[] =>
  Object.values(readMarkerCollection());

export const clearPendingShidduchAction = (id: Identifier): void => {
  const markers = readMarkerCollection();
  delete markers[String(id)];
  writeMarkerCollection(markers);
};

// Kept as small compatibility helpers for integrations that only know about
// the original delete-specific API. They use the same collection key.
export const rememberPendingShidduchDelete = (marker: {
  id: Identifier;
  deadline: number;
}): boolean =>
  rememberPendingShidduchAction({ ...marker, kind: "delete", origin: "page" });

export const readPendingShidduchDelete = (): {
  id: Identifier;
  deadline: number;
} | null => {
  const marker = readPendingShidduchActions().find(
    (candidate) => candidate.kind === "delete",
  );
  return marker ? { id: marker.id, deadline: marker.deadline } : null;
};

export const clearPendingShidduchDelete = (id?: Identifier): void => {
  if (id != null) {
    clearPendingShidduchAction(id);
    return;
  }
  readPendingShidduchActions()
    .filter((marker) => marker.kind === "delete")
    .forEach((marker) => clearPendingShidduchAction(marker.id));
};

export const getPendingShidduchActions = (
  state: unknown,
): ShidduchLifecycleAction[] => {
  const routeAction = getPendingShidduchAction(state);
  const markers = readPendingShidduchActions();
  const actions: ShidduchLifecycleAction[] = markers.map((marker) => ({
    kind: marker.kind,
    id: marker.id,
    name: `#${marker.id}`,
    deadline: marker.deadline,
    origin: marker.origin,
    retryRequired: marker.retryRequired,
  }));
  if (!routeAction) return actions;
  const existing = actions.findIndex(
    (action) => String(action.id) === String(routeAction.id),
  );
  if (existing >= 0) actions[existing] = routeAction;
  else actions.unshift(routeAction);
  return actions;
};

export const getPendingShidduchExclusionFilter = (
  state: unknown,
): Record<string, string> => {
  const ids = [
    ...new Set(
      getPendingShidduchActions(state)
        .map((action) => String(action.id))
        .filter((id) => /^\d+$/.test(id)),
    ),
  ];
  return ids.length > 0 ? { "id@not.in": `(${ids.join(",")})` } : {};
};

export const getRetryNotificationKey = (
  action: Pick<ShidduchLifecycleAction, "id" | "kind" | "deadline">,
): string => `${action.kind}:${String(action.id)}:${action.deadline}`;

export const getPendingShidduchAction = (state: unknown) => {
  const value = (state as { shidduchLifecycle?: unknown } | null)
    ?.shidduchLifecycle;
  if (!value || typeof value !== "object") return null;
  const action = value as Partial<ShidduchLifecycleAction>;
  if (
    (action.kind !== "archive" && action.kind !== "delete") ||
    action.id == null ||
    typeof action.name !== "string" ||
    typeof action.deadline !== "number" ||
    (action.origin !== undefined &&
      action.origin !== "page" &&
      action.origin !== "row")
  ) {
    return null;
  }
  return {
    ...action,
    origin: action.origin ?? "page",
  } as ShidduchLifecycleAction;
};

export const canManageShidduchLifecycle = (role: unknown): boolean =>
  role === "parent_admin" || role === "self_manager";

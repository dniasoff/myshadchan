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

export const canManageShidduchLifecycle = (role: unknown): boolean =>
  role === "parent_admin" || role === "self_manager";

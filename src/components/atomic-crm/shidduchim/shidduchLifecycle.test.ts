import { describe, expect, it } from "vitest";

import {
  canManageShidduchLifecycle,
  SHIDDUCH_ACTION_UNDO_MS,
} from "./shidduchLifecycle";

describe("shidduch lifecycle policy", () => {
  it.each(["parent_admin", "self_manager"])(
    "allows %s to use archive and delete actions",
    (role) => {
      expect(canManageShidduchLifecycle(role)).toBe(true);
    },
  );

  it.each(["single", "pending", "helper", "shadchan", undefined, null])(
    "fails closed for %s",
    (role) => {
      expect(canManageShidduchLifecycle(role)).toBe(false);
    },
  );

  it("keeps the approved Undo window at ten seconds", () => {
    expect(SHIDDUCH_ACTION_UNDO_MS).toBe(10_000);
  });
});

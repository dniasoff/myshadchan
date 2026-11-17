import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingShidduchDelete,
  getPendingShidduchAction,
  readPendingShidduchDelete,
  rememberPendingShidduchDelete,
  SHIDDUCH_DELETE_MARKER_KEY,
} from "./shidduchLifecycle";

describe("shidduch lifecycle persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("stores only the opaque id and deadline for a pending delete", () => {
    rememberPendingShidduchDelete({ id: 42, deadline: 123 });

    expect(window.sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY)).toBe(
      '{"id":42,"deadline":123}',
    );
    expect(readPendingShidduchDelete()).toEqual({ id: 42, deadline: 123 });
  });

  it("survives a reload marker read and can be cleared by Undo or completion", () => {
    rememberPendingShidduchDelete({ id: "opaque-id", deadline: 456 });

    expect(readPendingShidduchDelete()).toEqual({
      id: "opaque-id",
      deadline: 456,
    });

    clearPendingShidduchDelete();
    expect(readPendingShidduchDelete()).toBeNull();
  });

  it("fails closed when the marker is lost or malformed", () => {
    expect(readPendingShidduchDelete()).toBeNull();
    window.sessionStorage.setItem(SHIDDUCH_DELETE_MARKER_KEY, "not-json");
    expect(readPendingShidduchDelete()).toBeNull();
    expect(getPendingShidduchAction(undefined)).toBeNull();
  });
});

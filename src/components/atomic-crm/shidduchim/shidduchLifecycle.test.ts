import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingShidduchDelete,
  getPendingShidduchAction,
  getPendingShidduchActions,
  getPendingShidduchExclusionFilter,
  getRetryNotificationKey,
  readPendingShidduchActions,
  readPendingShidduchDelete,
  rememberPendingShidduchAction,
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
      '{"42":{"id":42,"deadline":123,"kind":"delete"}}',
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

  it("reconciles a route-change action with the persisted marker for the same row", () => {
    rememberPendingShidduchAction({
      id: 42,
      kind: "delete",
      deadline: 123,
    });

    expect(
      getPendingShidduchActions({
        shidduchLifecycle: {
          id: 42,
          kind: "delete",
          name: "Chaya Cohen",
          deadline: 456,
        },
      }),
    ).toEqual([
      {
        id: 42,
        kind: "delete",
        name: "Chaya Cohen",
        deadline: 456,
      },
    ]);
  });

  it("keeps concurrent archive and delete markers in one keyed collection", () => {
    rememberPendingShidduchAction({
      id: 42,
      kind: "archive",
      deadline: 123,
    });
    rememberPendingShidduchAction({
      id: 43,
      kind: "delete",
      deadline: 456,
    });

    expect(readPendingShidduchActions()).toEqual([
      { id: 42, kind: "archive", deadline: 123 },
      { id: 43, kind: "delete", deadline: 456 },
    ]);

    expect(
      rememberPendingShidduchAction({
        id: 42,
        kind: "archive",
        deadline: 999,
      }),
    ).toBe(true);
    expect(readPendingShidduchActions()[0]).toEqual({
      id: 42,
      kind: "archive",
      deadline: 999,
    });

    expect(
      rememberPendingShidduchAction({
        id: 42,
        kind: "delete",
        deadline: 1_000,
      }),
    ).toBe(true);
    expect(readPendingShidduchActions()[0]).toEqual({
      id: 42,
      kind: "delete",
      deadline: 1_000,
    });

    expect(
      rememberPendingShidduchAction({
        id: 42,
        kind: "delete",
        deadline: 1_000,
        retryRequired: true,
      }),
    ).toBe(true);
    expect(readPendingShidduchActions()[0]).toEqual({
      id: 42,
      kind: "delete",
      deadline: 1_000,
      retryRequired: true,
    });

    const exactDuplicate = window.sessionStorage.getItem(
      SHIDDUCH_DELETE_MARKER_KEY,
    );
    expect(
      rememberPendingShidduchAction({
        id: 42,
        kind: "delete",
        deadline: 1_000,
        retryRequired: true,
      }),
    ).toBe(true);
    expect(window.sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY)).toBe(
      exactDuplicate,
    );

    // A reload has no route state, so the complete collection must still
    // produce one exclusion filter for both pending rows.
    expect(getPendingShidduchActions(undefined)).toHaveLength(2);
    expect(getPendingShidduchExclusionFilter(undefined)).toEqual({
      "id@not.in": "(42,43)",
    });
  });

  it("reports marker persistence failure before a server mutation", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    expect(
      rememberPendingShidduchAction({
        id: 42,
        kind: "delete",
        deadline: 123,
      }),
    ).toBe(false);
    expect(
      window.sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY),
    ).toBeNull();
    setItem.mockRestore();
  });

  it("replaces an existing marker when its state changes", () => {
    rememberPendingShidduchAction({
      id: 42,
      kind: "archive",
      deadline: 123,
    });
    rememberPendingShidduchAction({
      id: 42,
      kind: "delete",
      deadline: 456,
      retryRequired: true,
    });
    expect(readPendingShidduchActions()).toEqual([
      { id: 42, kind: "delete", deadline: 456, retryRequired: true },
    ]);
  });

  it("deduplicates retry notifications by marker transition", () => {
    const action = {
      id: 42,
      kind: "delete" as const,
      deadline: 123,
      name: "#42",
      retryRequired: true,
    };
    expect(getRetryNotificationKey(action)).toBe("delete:42:123");
    expect(getRetryNotificationKey(action)).toBe(
      getRetryNotificationKey(action),
    );
    expect(getRetryNotificationKey({ ...action, id: 43 })).not.toBe(
      getRetryNotificationKey(action),
    );
  });

  it("fails closed when the marker is lost or malformed", () => {
    expect(readPendingShidduchDelete()).toBeNull();
    window.sessionStorage.setItem(SHIDDUCH_DELETE_MARKER_KEY, "not-json");
    expect(readPendingShidduchDelete()).toBeNull();
    expect(getPendingShidduchAction(undefined)).toBeNull();
  });
});

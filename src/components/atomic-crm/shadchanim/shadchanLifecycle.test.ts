import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingShadchanAction,
  readPendingShadchanAction,
  rememberPendingShadchanAction,
} from "./shadchanLifecycle";

describe("shadchan lifecycle Undo marker", () => {
  beforeEach(() => {
    clearPendingShadchanAction();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("keeps the identifying action in memory, never browser storage", () => {
    const action = {
      id: 42,
      name: "Miriam Gold",
      deadline: 1_700_000_000_000,
    };

    expect(rememberPendingShadchanAction(action)).toBe(true);
    expect(readPendingShadchanAction()).toEqual(action);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);

    clearPendingShadchanAction();
    expect(readPendingShadchanAction()).toBeNull();
  });
});

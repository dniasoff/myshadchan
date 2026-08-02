import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 7.3 (Task 3): AD-10 parity for the demo build — the FakeRest mirror
 * of `set_thread_visibility()` must reproduce its participant gate, "so the
 * demo build does not offer a control that silently succeeds for
 * everyone." Same identity convention as `dataProvider.createThread.test.ts`
 * (user_id "0" -> account_members id 1, parent_admin on account 1).
 */

const CALLER_MEMBER_ID = 1;
const OTHER_MEMBER_ID = 2;

const makeProvider = (db: Db) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0 }) },
  });

const seedThread = (
  db: Db,
  overrides: { visibility?: "open" | "private" } = {},
) => {
  db.account_members = [
    {
      id: CALLER_MEMBER_ID,
      account_id: 1,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: OTHER_MEMBER_ID,
      account_id: 1,
      user_id: "1",
      role: "helper",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.threads = [
    {
      id: 1,
      account_id: 1,
      connection_id: null,
      subject_type: "relationship",
      subject_id: null,
      visibility: overrides.visibility ?? "open",
      created_by_member_id: CALLER_MEMBER_ID,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.thread_participants = [
    {
      id: 1,
      account_id: 1,
      connection_id: null,
      thread_id: 1,
      member_id: CALLER_MEMBER_ID,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
};

describe("FakeRest setThreadVisibility() — AD-10 parity (Story 7.3)", () => {
  it("a listed participant can flip an open thread to private", async () => {
    // Arrange
    const db = generateData();
    seedThread(db, { visibility: "open" });
    const dataProvider = makeProvider(db);

    // Act
    const updated = await dataProvider.setThreadVisibility(1, "private");

    // Assert
    expect(updated.visibility).toBe("private");
  });

  it("the round trip is symmetric: private -> open also succeeds for a participant", async () => {
    // Arrange
    const db = generateData();
    seedThread(db, { visibility: "private" });
    const dataProvider = makeProvider(db);

    // Act
    const updated = await dataProvider.setThreadVisibility(1, "open");

    // Assert
    expect(updated.visibility).toBe("open");
  });

  it("rejects an invalid visibility value even for a real participant", async () => {
    // Arrange
    const db = generateData();
    seedThread(db, { visibility: "open" });
    const dataProvider = makeProvider(db);

    // Act / Assert
    await expect(
      dataProvider.setThreadVisibility(1, "not-a-real-visibility" as never),
    ).rejects.toThrow(/invalid thread visibility/);
  });

  it("a same-account non-participant cannot flip an OPEN thread's visibility", async () => {
    // Arrange — caller is OTHER_MEMBER_ID this time, never listed on the thread.
    const db = generateData();
    seedThread(db, { visibility: "open" });
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: 1 }) },
    });

    // Act / Assert
    await expect(
      dataProvider.setThreadVisibility(1, "private"),
    ).rejects.toThrow(/only a listed participant/);
    expect(db.threads[0].visibility).toBe("open");
  });
});

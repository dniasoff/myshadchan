import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 7.4 (Task 6): AD-10 parity for the demo build — the FakeRest mirror
 * of the connection axis `create_thread()`, `thread_is_readable()`'s scope
 * gate, and the messages/thread_participants/set_thread_visibility write
 * paths all gained (Story 7.1/7.3's account-only versions are covered by
 * `dataProvider.createThread.test.ts` / `dataProvider.setThreadVisibility.test.ts`
 * already — this file is the connection-branch sibling).
 *
 * Fixture: a household (account 1) and a shadchanus (account 2) joined by an
 * ACCEPTED connection (id 1); a parent_admin on the household (member 1,
 * user "0"), a shadchan on the shadchanus account (member 2, user "1"), and
 * a parent_admin on a wholly UNRELATED third household (member 3, user "2")
 * — the "not a party at all" negative every write path needs.
 */

const HOUSEHOLD_ACCOUNT_ID = 1;
const SHADCHANUS_ACCOUNT_ID = 2;
const UNRELATED_ACCOUNT_ID = 3;
const CONNECTION_ID = 1;

const PARENT_MEMBER_ID = 1;
const SHADCHAN_MEMBER_ID = 2;
const UNRELATED_MEMBER_ID = 3;

const asParent = { id: 0 };
const asShadchan = { id: 1 };
const asUnrelated = { id: 2 };

// Each identity below holds exactly ONE membership in the fixture, so
// `resolveContextMembership`'s "fall back to the login's first membership"
// rule already resolves the right account — no `switchActiveContext` call
// needed, mirroring `dataProvider.createThread.test.ts`'s own convention.
const makeProvider = (db: Db, identity: { id: number } = asParent) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => identity },
  });

function seedConnectionFixture(db: Db): void {
  db.accounts = [
    {
      id: HOUSEHOLD_ACCOUNT_ID,
      name: "Household",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SHADCHANUS_ACCOUNT_ID,
      name: "Shadchanus",
      transparency_level: "shared",
      kind: "shadchanus",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: UNRELATED_ACCOUNT_ID,
      name: "Unrelated Household",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.account_members = [
    {
      id: PARENT_MEMBER_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SHADCHAN_MEMBER_ID,
      account_id: SHADCHANUS_ACCOUNT_ID,
      user_id: "1",
      role: "shadchan",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: UNRELATED_MEMBER_ID,
      account_id: UNRELATED_ACCOUNT_ID,
      user_id: "2",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.connections = [
    {
      id: CONNECTION_ID,
      household_account_id: HOUSEHOLD_ACCOUNT_ID,
      shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
      status: "accepted",
      ended_at: null,
      proposed_by_account_id: HOUSEHOLD_ACCOUNT_ID,
      accepted_at: "2026-01-01T00:00:00Z",
      ended_by_account_id: null,
      created_at: "2026-01-01T00:00:00Z",
      household_account_name: "Test Household",
    },
  ];
  db.threads = [];
  db.thread_participants = [];
  db.messages = [];
}

describe("FakeRest createThread() — connection axis (Story 7.4)", () => {
  it("creates a connection-scoped thread (account_id null, connection_id set) when the household side calls it", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const dataProvider = makeProvider(db, asParent);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "relationship",
      connection_id: CONNECTION_ID,
      visibility: "open",
    });

    // Assert
    expect(thread.account_id).toBeNull();
    expect(thread.connection_id).toBe(CONNECTION_ID);
  });

  it("resolves an omitted visibility from the connection's HOUSEHOLD account, even when the caller is the shadchanus side", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    db.accounts[0].default_thread_visibility = "private"; // household
    db.accounts[1].default_thread_visibility = "open"; // shadchanus
    const dataProvider = makeProvider(db, asShadchan);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "relationship",
      connection_id: CONNECTION_ID,
    });

    // Assert — the shadchanus account's OWN 'open' default has no effect.
    expect(thread.visibility).toBe("private");
  });

  it("accepts a participant from the OTHER side of the connection (cross-side is the whole point)", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const dataProvider = makeProvider(db, asParent);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "relationship",
      connection_id: CONNECTION_ID,
      participant_member_ids: [SHADCHAN_MEMBER_ID],
    });

    // Assert
    const { data: participants } = await dataProvider.getList(
      "thread_participants",
      {
        filter: { thread_id: thread.id },
        pagination: { page: 1, perPage: 10 },
        sort: { field: "id", order: "ASC" },
      },
    );
    expect(participants.map((p) => p.member_id)).toContain(SHADCHAN_MEMBER_ID);
  });

  it("rejects a participant belonging to neither side of the connection", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const dataProvider = makeProvider(db, asParent);

    // Act / Assert
    await expect(
      dataProvider.createThread({
        subject_type: "relationship",
        connection_id: CONNECTION_ID,
        participant_member_ids: [UNRELATED_MEMBER_ID],
      }),
    ).rejects.toThrow(/not found in either side of this connection/);
  });

  it("rejects a caller whose active account is neither side of the connection", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const dataProvider = makeProvider(db, asUnrelated);

    // Act / Assert
    await expect(
      dataProvider.createThread({
        subject_type: "relationship",
        connection_id: CONNECTION_ID,
      }),
    ).rejects.toThrow(/not active for the current context/);
  });
});

describe("FakeRest messages / thread_participants / setThreadVisibility — connection scope gate (Story 7.4)", () => {
  function seedConnectionThread(db: Db): number {
    const threadId = 1;
    db.threads.push({
      id: threadId,
      account_id: null,
      connection_id: CONNECTION_ID,
      subject_type: "relationship",
      subject_id: null,
      visibility: "private",
      created_by_member_id: PARENT_MEMBER_ID,
      created_at: "2026-01-01T00:00:00Z",
    });
    db.thread_participants.push(
      {
        id: 1,
        account_id: null,
        connection_id: CONNECTION_ID,
        thread_id: threadId,
        member_id: PARENT_MEMBER_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        account_id: null,
        connection_id: CONNECTION_ID,
        thread_id: threadId,
        member_id: SHADCHAN_MEMBER_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
    );
    return threadId;
  }

  it("a participant on the OTHER side of the connection can post a real message (AC-6 parity)", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const threadId = seedConnectionThread(db);
    const dataProvider = makeProvider(db, asShadchan);

    // Act
    const { data: message } = await dataProvider.create("messages", {
      data: { thread_id: threadId, body: "Hello from the shadchan side" },
    });

    // Assert
    expect(message.sender_member_id).toBe(SHADCHAN_MEMBER_ID);
    expect(message.connection_id).toBe(CONNECTION_ID);
    expect(message.account_id).toBeNull();
  });

  it("a caller who is not a party to the connection at all cannot post, even the correct thread id", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const threadId = seedConnectionThread(db);
    const dataProvider = makeProvider(db, asUnrelated);

    // Act / Assert
    await expect(
      dataProvider.create("messages", {
        data: { thread_id: threadId, body: "an outsider trying to post" },
      }),
    ).rejects.toThrow(/not found in current account/);
  });

  it("set_thread_visibility succeeds for a real participant while the connection is accepted", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const threadId = seedConnectionThread(db);
    const dataProvider = makeProvider(db, asShadchan);

    // Act
    const updated = await dataProvider.setThreadVisibility(threadId, "open");

    // Assert
    expect(updated.visibility).toBe("open");
  });

  it("ending the connection denies every write path that used to succeed for the SAME real participant", async () => {
    // Arrange
    const db = generateData();
    seedConnectionFixture(db);
    const threadId = seedConnectionThread(db);
    db.connections[0].status = "ended";
    const dataProvider = makeProvider(db, asShadchan);

    // Act / Assert
    await expect(
      dataProvider.create("messages", {
        data: { thread_id: threadId, body: "after the connection ended" },
      }),
    ).rejects.toThrow(/not found in current account/);
    await expect(
      dataProvider.setThreadVisibility(threadId, "private"),
    ).rejects.toThrow(/not found in current account/);
  });
});

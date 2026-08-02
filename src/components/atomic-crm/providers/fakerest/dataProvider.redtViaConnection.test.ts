import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 8.3 (Task 5): AD-10 parity for the demo build — the FakeRest mirror
 * of `redt_via_connection()`. Every predicate is copied from the SQL
 * function's own validation, in the same order (`./internal/redting.ts`'s
 * own header comment). Mirrors `dataProvider.threadsConnectionAxis.test.ts`'s
 * own fixture shape (Story 7.4) — a household and a shadchanus account
 * joined by an accepted connection, plus a second, differently-connected
 * shadchan for the "cannot reuse another connection's id" negative.
 */

const HOUSEHOLD_ACCOUNT_ID = 1;
const SHADCHANUS_S1_ACCOUNT_ID = 2;
const SHADCHANUS_S2_ACCOUNT_ID = 3;
const CONNECTION_A_S1 = 1;
const CONNECTION_A_S2 = 2;

const PARENT_MEMBER_ID = 1;
const SHADCHAN_S1_MEMBER_ID = 2;
const SHADCHAN_S2_MEMBER_ID = 3;

const asParent = { id: 0 };
const asShadchanS1 = { id: 1 };
const asShadchanS2 = { id: 2 };

const SORT_BY_ID = { field: "id", order: "ASC" } as const;

// Each identity below holds exactly ONE membership in the fixture, so
// `resolveContextMembership`'s "fall back to the login's first membership"
// rule already resolves the right account — no `switchActiveContext` call
// needed, mirroring `dataProvider.threadsConnectionAxis.test.ts`'s own
// convention.
const makeProvider = (db: Db, identity: { id: number } = asParent) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => identity },
  });

function seedFixture(db: Db): void {
  db.accounts = [
    {
      id: HOUSEHOLD_ACCOUNT_ID,
      name: "Redting Household",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SHADCHANUS_S1_ACCOUNT_ID,
      name: "Redting Shadchanus S1",
      transparency_level: "shared",
      kind: "shadchanus",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SHADCHANUS_S2_ACCOUNT_ID,
      name: "Redting Shadchanus S2",
      transparency_level: "shared",
      kind: "shadchanus",
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
      id: SHADCHAN_S1_MEMBER_ID,
      account_id: SHADCHANUS_S1_ACCOUNT_ID,
      user_id: "1",
      role: "shadchan",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SHADCHAN_S2_MEMBER_ID,
      account_id: SHADCHANUS_S2_ACCOUNT_ID,
      user_id: "2",
      role: "shadchan",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.connections = [
    {
      id: CONNECTION_A_S1,
      household_account_id: HOUSEHOLD_ACCOUNT_ID,
      shadchanus_account_id: SHADCHANUS_S1_ACCOUNT_ID,
      status: "accepted",
      ended_at: null,
      proposed_by_account_id: HOUSEHOLD_ACCOUNT_ID,
      accepted_at: "2026-01-01T00:00:00Z",
      ended_by_account_id: null,
      created_at: "2026-01-01T00:00:00Z",
      household_account_name: "Test Household",
    },
    // S2's OWN, separate accepted connection to the same household — AC-6(c)
    // needs S2 to be genuinely connected to the household, just via a
    // DIFFERENT connection row.
    {
      id: CONNECTION_A_S2,
      household_account_id: HOUSEHOLD_ACCOUNT_ID,
      shadchanus_account_id: SHADCHANUS_S2_ACCOUNT_ID,
      status: "accepted",
      ended_at: null,
      proposed_by_account_id: HOUSEHOLD_ACCOUNT_ID,
      accepted_at: "2026-01-01T00:00:00Z",
      ended_by_account_id: null,
      created_at: "2026-01-01T00:00:00Z",
      household_account_name: "Test Household",
    },
  ];
  db.inbox_items = [];
  db.threads = [];
  db.thread_participants = [];
  db.messages = [];
}

describe("FakeRest redtViaConnection() (Story 8.3)", () => {
  it("AC-2/AC-3: lands as an unfiled inbox_items row on the household, attributed to the shadchan by name", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);

    // Act
    const item = await dataProvider.redtViaConnection({
      connection_id: CONNECTION_A_S1,
      subject: "A suggestion for Rivky",
      raw_text: "Dovid Berkowitz, BMG",
      attachments: null,
    });

    // Assert
    expect(item.account_id).toBe(HOUSEHOLD_ACCOUNT_ID);
    expect(item.source).toBe("shadchan");
    expect(item.status).toBe("unresolved");
    expect(item.sender).toBe("Redting Shadchanus S1");
    expect(item.connection_id).toBe(CONNECTION_A_S1);
    expect(item.single_id).toBeNull();
    expect(item.shadchan_id).toBeNull();
  });

  it("AC-5: mirrors the redt into a connection-scoped thread carrying one message with the raw text", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);
    const listAll = { pagination: { page: 1, perPage: 10 }, sort: SORT_BY_ID };

    // Act
    await dataProvider.redtViaConnection({
      connection_id: CONNECTION_A_S1,
      subject: null,
      raw_text: "Dovid Berkowitz, BMG",
      attachments: null,
    });

    // Assert — read back through the dataProvider (not the seed `db`
    // reference), the same convention
    // dataProvider.threadsConnectionAxis.test.ts uses: the FakeRest engine
    // owns its own internal store once constructed, so a direct `db.*` read
    // after that point can go stale.
    const { data: threads } = await dataProvider.getList("threads", {
      ...listAll,
      filter: { connection_id: CONNECTION_A_S1 },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      account_id: null,
      connection_id: CONNECTION_A_S1,
      subject_type: "relationship",
    });

    const { data: messages } = await dataProvider.getList("messages", {
      ...listAll,
      filter: { thread_id: threads[0].id },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      body: "Dovid Berkowitz, BMG",
      sender_member_id: SHADCHAN_S1_MEMBER_ID,
    });

    const { data: participants } = await dataProvider.getList(
      "thread_participants",
      { ...listAll, filter: { thread_id: threads[0].id } },
    );
    const participantIds = participants.map((p) => p.member_id);
    expect(participantIds).toContain(SHADCHAN_S1_MEMBER_ID);
    expect(participantIds).toContain(PARENT_MEMBER_ID);
  });

  it("AC-6(a): rejects a nonexistent connection id and creates nothing", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);

    // Act / Assert
    await expect(
      dataProvider.redtViaConnection({
        connection_id: 999_999,
        subject: null,
        raw_text: "should never land",
        attachments: null,
      }),
    ).rejects.toThrow(/is not an active connection/);
    const { total } = await dataProvider.getList("inbox_items", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { raw_text: "should never land" },
    });
    expect(total).toBe(0);
  });

  it("AC-6(b): rejects an ended connection — not retroactive, the earlier item survives", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);
    const firstItem = await dataProvider.redtViaConnection({
      connection_id: CONNECTION_A_S1,
      subject: null,
      raw_text: "sent while accepted",
      attachments: null,
    });
    // Ends the connection through the SAME provider instance (Story 8.2's
    // endConnection(), a party to the connection) — mutating the seed `db`
    // object directly here would not reach the engine's own internal store
    // once constructed (see the AC-5 test's comment above).
    await dataProvider.endConnection(CONNECTION_A_S1);

    // Act / Assert
    await expect(
      dataProvider.redtViaConnection({
        connection_id: CONNECTION_A_S1,
        subject: null,
        raw_text: "should never land",
        attachments: null,
      }),
    ).rejects.toThrow(/is not an active connection/);
    const { data: survivor } = await dataProvider.getOne("inbox_items", {
      id: firstItem.id,
    });
    expect(survivor.status).toBe("unresolved");
    const { total: newAttempts } = await dataProvider.getList("inbox_items", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { raw_text: "should never land" },
    });
    expect(newAttempts).toBe(0);
  });

  it("AC-6(c): shadchan S2 cannot reuse S1's connection id, even though S2 has its own real connection to the same household", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS2);

    // Act / Assert
    await expect(
      dataProvider.redtViaConnection({
        connection_id: CONNECTION_A_S1,
        subject: null,
        raw_text: "S2 trying S1's id",
        attachments: null,
      }),
    ).rejects.toThrow(
      /not an active member of this connection's shadchanus context/,
    );
    const { total } = await dataProvider.getList("inbox_items", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { raw_text: "S2 trying S1's id" },
    });
    expect(total).toBe(0);
  });

  it("Finding 4 (review fix): a caller who ALSO holds an active membership of the shadchanus account, but is ACTING AS household A, is rejected — and the same caller ACTING AS the shadchan succeeds with consistent attribution", async () => {
    // Arrange — the household's own parent (user "0") is additionally given
    // an active membership of shadchanus S1 (id 4), while remaining an
    // active member of the household and keeping the household as the
    // active context (their first, and so far only, activated context).
    const DUAL_MEMBERSHIP_MEMBER_ID = 4;
    const db = generateData();
    seedFixture(db);
    db.account_members.push({
      id: DUAL_MEMBERSHIP_MEMBER_ID,
      account_id: SHADCHANUS_S1_ACCOUNT_ID,
      user_id: "0",
      role: "shadchan",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    });
    const dataProvider = makeProvider(db, asParent);

    // Act / Assert — acting as the household, this must be refused even
    // though this exact user also holds an active membership of S1.
    await expect(
      dataProvider.redtViaConnection({
        connection_id: CONNECTION_A_S1,
        subject: null,
        raw_text: "acting as household, not shadchan",
        attachments: null,
      }),
    ).rejects.toThrow(
      /not an active member of this connection's shadchanus context/,
    );
    const { total: divergentAttempts } = await dataProvider.getList(
      "inbox_items",
      {
        pagination: { page: 1, perPage: 10 },
        sort: SORT_BY_ID,
        filter: { raw_text: "acting as household, not shadchan" },
      },
    );
    expect(divergentAttempts).toBe(0);

    // Act — switching this SAME user's active context to shadchanus S1 (now
    // ACTING AS the shadchan) lets the identical connection id succeed, and
    // every field naming "who acted" agrees with that context.
    await dataProvider.switchActiveContext(SHADCHANUS_S1_ACCOUNT_ID);
    const item = await dataProvider.redtViaConnection({
      connection_id: CONNECTION_A_S1,
      subject: null,
      raw_text: "acting as the shadchan now",
      attachments: null,
    });

    // Assert
    expect(item.sender).toBe("Redting Shadchanus S1");
    expect(item.account_id).toBe(HOUSEHOLD_ACCOUNT_ID);
    const { data: threads } = await dataProvider.getList("threads", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { connection_id: CONNECTION_A_S1, subject_type: "relationship" },
    });
    const dualMembershipThread = threads.find(
      (t) => t.created_by_member_id === DUAL_MEMBERSHIP_MEMBER_ID,
    );
    expect(dualMembershipThread).toBeDefined();
    const { data: messages } = await dataProvider.getList("messages", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { thread_id: dualMembershipThread!.id },
    });
    expect(messages[0]).toMatchObject({
      body: "acting as the shadchan now",
      sender_member_id: DUAL_MEMBERSHIP_MEMBER_ID,
    });
  });

  it("Finding 5 (review fix): a small, well-shaped attachments array is accepted", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);

    // Act
    const item = await dataProvider.redtViaConnection({
      connection_id: CONNECTION_A_S1,
      subject: null,
      raw_text: "Dovid Berkowitz, BMG",
      attachments: [{ name: "resume.pdf", src: "https://example.test/r.pdf" }],
    });

    // Assert — validation is not all-or-nothing.
    expect(item.attachments).toEqual([
      { name: "resume.pdf", src: "https://example.test/r.pdf" },
    ]);
  });

  it("Finding 5 (review fix): rejects a non-array attachments payload and creates nothing", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asShadchanS1);

    // Act / Assert
    await expect(
      dataProvider.redtViaConnection({
        connection_id: CONNECTION_A_S1,
        subject: null,
        raw_text: "should never land",
        attachments: { not: "an array" },
      }),
    ).rejects.toThrow(/attachments must be a JSON array/);
    const { total } = await dataProvider.getList("inbox_items", {
      pagination: { page: 1, perPage: 10 },
      sort: SORT_BY_ID,
      filter: { raw_text: "should never land" },
    });
    expect(total).toBe(0);
  });
});

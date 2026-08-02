import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { ThreadList } from "./ThreadList";

/**
 * Story 7.1 (AC-1, AC-2, AC-7) — falsifiable claims for the threads-for-a-
 * subject list: empty/loading/error states, the real FakeRest round trip
 * scoped by `subject_type`/`subject_id`, starting a discussion via the
 * `createThread()` custom method (never a raw `dataProvider.create
 * ("threads", …)`), and that the first (most recent) thread auto-selects
 * into the panel below it.
 */

const CALLER_MEMBER_ID = 1;

const seedCaller = (db: ReturnType<typeof generateData>) => {
  db.account_members = [
    {
      id: CALLER_MEMBER_ID,
      account_id: 1,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
};

const renderList = async (
  configureDb: (db: ReturnType<typeof generateData>) => void = () => {},
) => {
  const db = generateData();
  seedCaller(db);
  configureDb(db);
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ThreadList subjectType="shidduch" subjectId={1} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ThreadList — reading threads for a subject", () => {
  it("shows the empty state and no panel when the subject has no threads", async () => {
    // Act
    const { screen } = await renderList();

    // Assert
    await expect
      .element(screen.getByText("No discussions yet."))
      .toBeInTheDocument();
  });

  it("lists an existing thread on this subject and auto-selects it into the panel", async () => {
    // Act
    const { screen } = await renderList((db) => {
      db.threads = [
        {
          id: 1,
          account_id: 1,
          connection_id: null,
          subject_type: "shidduch",
          subject_id: 1,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
    });

    // Assert — the thread row renders, and its panel (no messages yet) is
    // already mounted alongside it without a click.
    await expect.element(screen.getByText("Open")).toBeInTheDocument();
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
  });

  it("never lists a thread on a DIFFERENT subject or subject_type", async () => {
    // Act
    const { screen } = await renderList((db) => {
      db.threads = [
        {
          id: 1,
          account_id: 1,
          connection_id: null,
          subject_type: "shidduch",
          subject_id: 9999999,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          account_id: 1,
          connection_id: null,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
    });

    // Assert
    await expect
      .element(screen.getByText("No discussions yet."))
      .toBeInTheDocument();
  });
});

describe("ThreadList — unread indicator (Story 7.5, AC-1)", () => {
  // Story 7.5 (AC-1, AC-2): thread 1 is the one under test; thread 2 is a
  // DECOY, dated more recently so `ThreadList` auto-selects IT into the
  // panel instead (`activeId = selectedId ?? data?.[0]?.id`, sorted DESC —
  // see `ThreadList.tsx`). Opening a thread now marks it read
  // (`ThreadPanel.tsx`'s own `markThreadRead()` effect), so thread 1 must
  // stay UN-opened for its "Unread" indicator to be observable at all —
  // without the decoy, the single auto-selected thread would mark itself
  // read within the same render pass these three tests inspect. Thread 2
  // carries no message, so it is never itself flagged unread regardless of
  // its own `last_read_at` (`computeUnreadThreadIds`'s `if (!latestMessage)
  // continue`) — it exists purely to redirect the auto-select, not to be
  // asserted on.
  const seedThreadWithMessage = (
    db: ReturnType<typeof generateData>,
    lastReadAt: string | null,
  ) => {
    db.threads = [
      {
        id: 1,
        account_id: 1,
        connection_id: null,
        subject_type: "shidduch",
        subject_id: 1,
        visibility: "open",
        created_by_member_id: CALLER_MEMBER_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        account_id: 1,
        connection_id: null,
        subject_type: "shidduch",
        subject_id: 1,
        visibility: "open",
        created_by_member_id: CALLER_MEMBER_ID,
        created_at: "2026-01-05T00:00:00Z",
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
        last_read_at: lastReadAt,
      },
      {
        id: 2,
        account_id: 1,
        connection_id: null,
        thread_id: 2,
        member_id: CALLER_MEMBER_ID,
        created_at: "2026-01-05T00:00:00Z",
        last_read_at: null,
      },
    ];
    db.messages = [
      {
        id: 1,
        account_id: 1,
        connection_id: null,
        thread_id: 1,
        sender_member_id: null,
        body: "A message arrived",
        created_at: "2026-01-02T00:00:00Z",
      },
    ];
  };

  it("marks a thread unread when the caller has never opened it (last_read_at null)", async () => {
    // Act
    const { screen } = await renderList((db) =>
      seedThreadWithMessage(db, null),
    );

    // Assert
    await expect.element(screen.getByText("Unread")).toBeInTheDocument();
  });

  it("marks a thread unread when a message postdates the caller's own last_read_at", async () => {
    // Act
    const { screen } = await renderList((db) =>
      seedThreadWithMessage(db, "2026-01-01T12:00:00Z"),
    );

    // Assert — the message (2026-01-02) is newer than last_read_at (2026-01-01).
    await expect.element(screen.getByText("Unread")).toBeInTheDocument();
  });

  it("does not mark a thread unread once the caller's last_read_at is after every message", async () => {
    // Act
    const { screen } = await renderList((db) =>
      seedThreadWithMessage(db, "2026-01-03T00:00:00Z"),
    );

    // Assert — both rows render their "Open" visibility label (the decoy
    // thread 2 has one too), so this is no longer a unique match; `.first()`
    // only needs to prove the list actually rendered rows at all.
    await expect.element(screen.getByText("Open").first()).toBeInTheDocument();
    expect(screen.getByText("Unread").query()).toBeNull();
  });

  // Review finding: the three tests above only exercise the PURE
  // `computeUnreadThreadIds` function against a pre-set `last_read_at`
  // fixture — none of them ever open a thread and observe the indicator
  // react to it. `markThreadRead()` (`ThreadPanel.tsx`) was wired nowhere in
  // `src/` before this test existed: proven red against that unwired code
  // (thread 1's row selected and its panel mounted, but
  // `dataProvider.markThreadRead` was never called, so the seeded
  // `last_read_at: null` row never changed and "Unread" never left the DOM
  // within this test's retry window).
  it("selecting the unread thread's row marks it read and the indicator clears without a reload", async () => {
    // Arrange — thread 2 (the decoy) auto-selects; thread 1 stays un-opened
    // and starts unread.
    const { screen, dataProvider } = await renderList((db) =>
      seedThreadWithMessage(db, null),
    );
    await expect.element(screen.getByText("Unread")).toBeInTheDocument();

    // Act — a real user action opens thread 1: click ITS row specifically,
    // found by its accessible name (only the UNREAD row's name includes the
    // sr-only "Unread" text — thread 2's row is also labelled "Open" but
    // carries no "Unread", so this query cannot land on the decoy).
    await screen.getByRole("button", { name: /Unread/ }).click();

    // Assert — markThreadRead() + refresh() resolve on their own; the
    // indicator disappears with no manual re-render trigger.
    await expect.element(screen.getByText("Unread")).not.toBeInTheDocument();

    // Assert — the underlying row actually moved, through the real
    // dataProvider round trip, not just a client-side optimistic flicker.
    const { data: participants } = await dataProvider.getList(
      "thread_participants",
      {
        filter: { thread_id: 1, member_id: CALLER_MEMBER_ID },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      },
    );
    expect(participants[0].last_read_at).not.toBeNull();
  });
});

describe("ThreadList — connection-scoped (Story 8.5, Task 3)", () => {
  const HOUSEHOLD_ACCOUNT_ID = 1;
  const SHADCHANUS_ACCOUNT_ID = 9;
  const CONNECTION_A_ID = 501;
  const CONNECTION_B_ID = 502;

  const seedTwoConnections = (db: ReturnType<typeof generateData>) => {
    db.accounts = [
      ...db.accounts.filter((a) => a.id !== SHADCHANUS_ACCOUNT_ID),
      {
        id: SHADCHANUS_ACCOUNT_ID,
        name: "Golden Matches Shadchanus",
        transparency_level: "shared",
        kind: "shadchanus",
        default_thread_visibility: "open",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    db.account_members = [
      {
        id: CALLER_MEMBER_ID,
        account_id: SHADCHANUS_ACCOUNT_ID,
        user_id: "0",
        role: "shadchan",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    db.connections = [
      {
        id: CONNECTION_A_ID,
        household_account_id: HOUSEHOLD_ACCOUNT_ID,
        shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
        status: "accepted",
        ended_at: null,
        proposed_by_account_id: HOUSEHOLD_ACCOUNT_ID,
        accepted_at: "2026-01-01T00:00:00Z",
        ended_by_account_id: null,
        created_at: "2026-01-01T00:00:00Z",
        household_account_name: "Connection A Household",
      },
      {
        id: CONNECTION_B_ID,
        household_account_id: HOUSEHOLD_ACCOUNT_ID,
        shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
        status: "accepted",
        ended_at: null,
        proposed_by_account_id: HOUSEHOLD_ACCOUNT_ID,
        accepted_at: "2026-01-01T00:00:00Z",
        ended_by_account_id: null,
        created_at: "2026-01-02T00:00:00Z",
        household_account_name: "Connection B Household",
      },
    ];
  };

  const renderConnectionList = async (
    connectionId: number,
    configureDb: (db: ReturnType<typeof generateData>) => void = () => {},
  ) => {
    const db = generateData();
    seedTwoConnections(db);
    configureDb(db);
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <ThreadList connectionId={connectionId} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    return { screen, dataProvider };
  };

  it("lists only THIS connection's thread, never a sibling connection's — a subject_id-only filter could not tell them apart (both are subject_type='relationship', subject_id=null)", async () => {
    // Act
    const { screen } = await renderConnectionList(CONNECTION_A_ID, (db) => {
      db.threads = [
        {
          id: 1,
          account_id: null,
          connection_id: CONNECTION_A_ID,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-03T00:00:00Z",
        },
        {
          id: 2,
          account_id: null,
          connection_id: CONNECTION_B_ID,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-04T00:00:00Z",
        },
      ];
    });

    // Assert — exactly one row rendered (connection A's), never connection
    // B's, even though both share the identical (subject_type, subject_id).
    await expect.element(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Open").elements()).toHaveLength(1);
  });

  it("createThread() for a connectionId creates a relationship thread scoped to THAT connection, never account-scoped", async () => {
    // Act
    const { screen, dataProvider } =
      await renderConnectionList(CONNECTION_A_ID);
    await screen.getByRole("button", { name: "Start a discussion" }).click();

    // Assert
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
    const { data: threads } = await dataProvider.getList("threads", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      account_id: null,
      connection_id: CONNECTION_A_ID,
      subject_type: "relationship",
      subject_id: null,
    });
  });
});

describe("ThreadList — starting a discussion (AC-1, AC-2, AC-7)", () => {
  it("createThread() (never a raw create) makes a thread scoped to this subject, with the caller as its only participant", async () => {
    // Act
    const { screen, dataProvider } = await renderList();
    await screen.getByRole("button", { name: "Start a discussion" }).click();

    // Assert — the panel for the new thread mounts...
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
    // ...and the created row is exactly what create_thread() would produce.
    const { data: threads } = await dataProvider.getList("threads", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      account_id: 1,
      connection_id: null,
      subject_type: "shidduch",
      subject_id: 1,
      visibility: "open",
      created_by_member_id: CALLER_MEMBER_ID,
    });
    const { data: participants } = await dataProvider.getList(
      "thread_participants",
      {
        filter: { thread_id: threads[0].id },
        pagination: { page: 1, perPage: 10 },
        sort: { field: "id", order: "ASC" },
      },
    );
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({ member_id: CALLER_MEMBER_ID });
  });
});

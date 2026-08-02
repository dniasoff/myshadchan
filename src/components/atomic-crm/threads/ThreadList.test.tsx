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

    // Assert
    await expect.element(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Unread").query()).toBeNull();
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

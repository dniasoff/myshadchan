import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { ThreadPanel } from "./ThreadPanel";

// authProvider.getIdentity() resolves the DEFAULT_USER seed (members id 0,
// i.e. account_members.user_id "0") unless a real login() call overrides
// localStorage — see providers/fakerest/authProvider.ts. Overriding
// db.account_members to a single, fully-controlled membership tied to that
// same "0" keeps every test's resolved caller membership id fixed and known,
// rather than depending on generateData()'s own (larger, less predictable)
// seeded roster.
const CALLER_MEMBER_ID = 1;
const seedCallerMembership = (db: ReturnType<typeof generateData>) => {
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

/**
 * Story 7.1 (AC-4, AC-8) — falsifiable claims for the messages half of the
 * Discussions tab: empty/loading/error states, the real FakeRest round trip
 * scoped by `thread_id`, and the AC-8 participant gate surfacing through
 * `useNotify()` rather than crashing the composer.
 */

// `participantMemberId` defaults to the caller's own membership (the
// "listed participant" shape); pass a different id (e.g. 999) to arrange
// the AC-8 denial shape instead. `seedCallerMembership` always runs too —
// caller identity resolution must succeed in every case, only whether the
// caller IS the participant varies.
const seedThreadWithParticipant = (
  db: ReturnType<typeof generateData>,
  participantMemberId: number = CALLER_MEMBER_ID,
) => {
  seedCallerMembership(db);
  db.threads = [
    {
      id: 1,
      account_id: 1,
      connection_id: null,
      subject_type: "relationship",
      subject_id: null,
      visibility: "open",
      created_by_member_id: participantMemberId,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.thread_participants = [
    {
      id: 1,
      account_id: 1,
      connection_id: null,
      thread_id: 1,
      member_id: participantMemberId,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
};

const renderPanel = async (
  configureDb: (db: ReturnType<typeof generateData>) => void,
) => {
  const db = generateData();
  configureDb(db);
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ThreadPanel threadId={1} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, db, dataProvider };
};

describe("ThreadPanel — reading messages", () => {
  it("shows the empty state when the thread has no messages", async () => {
    // Act
    const { screen } = await renderPanel((db) => seedThreadWithParticipant(db));

    // Assert
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
  });

  it("renders every message body for the thread, oldest first", async () => {
    // Arrange
    const { screen } = await renderPanel((db) => {
      seedThreadWithParticipant(db);
      db.messages = [
        {
          id: 1,
          account_id: 1,
          connection_id: null,
          thread_id: 1,
          sender_member_id: 1,
          body: "First message",
          created_at: "2026-01-01T09:00:00Z",
        },
        {
          id: 2,
          account_id: 1,
          connection_id: null,
          thread_id: 1,
          sender_member_id: 1,
          body: "Second message",
          created_at: "2026-01-01T10:00:00Z",
        },
      ];
    });

    // Assert
    await expect.element(screen.getByText("First message")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Second message"))
      .toBeInTheDocument();
  });
});

describe("ThreadPanel — the composer (AC-4, AC-8)", () => {
  it("a listed participant can post, and the new message appears without a page reload", async () => {
    // Arrange — the caller IS the thread's listed participant.
    const { screen, dataProvider } = await renderPanel((db) =>
      seedThreadWithParticipant(db),
    );

    // Act
    await screen
      .getByPlaceholder("Write a message…")
      .fill("Hello from the composer");
    await screen.getByRole("button", { name: "Send" }).click();

    // Assert — the DOM update, plus the row's server-stamped fields read
    // back through the real dataProvider (fakerest's own store, not this
    // test's initial `db` object reference).
    await expect
      .element(screen.getByText("Hello from the composer"))
      .toBeInTheDocument();
    const { data: messages } = await dataProvider.getList("messages", {
      filter: { thread_id: 1 },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      thread_id: 1,
      body: "Hello from the composer",
      account_id: 1,
      connection_id: null,
      sender_member_id: CALLER_MEMBER_ID,
    });
  });

  it("a non-participant's post is denied and surfaces through a notification, not a crash", async () => {
    // Arrange — the thread's only participant is member 999, never the
    // signed-in caller.
    const { screen, dataProvider } = await renderPanel((db) =>
      seedThreadWithParticipant(db, 999),
    );

    // Act
    await screen.getByPlaceholder("Write a message…").fill("Not allowed");
    await screen.getByRole("button", { name: "Send" }).click();

    // Assert — denied, and no message row was written.
    await expect
      .element(screen.getByText(/only a listed participant/i))
      .toBeInTheDocument();
    const { data: messages } = await dataProvider.getList("messages", {
      filter: { thread_id: 1 },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(messages).toHaveLength(0);
  });

  it("the Send button stays disabled for a blank or whitespace-only body", async () => {
    // Act
    const { screen } = await renderPanel((db) => seedThreadWithParticipant(db));

    // Assert — blank by default...
    await expect
      .element(screen.getByRole("button", { name: "Send" }))
      .toBeDisabled();

    // ...and still disabled after typing only whitespace.
    await screen.getByPlaceholder("Write a message…").fill("   ");
    await expect
      .element(screen.getByRole("button", { name: "Send" }))
      .toBeDisabled();
  });
});

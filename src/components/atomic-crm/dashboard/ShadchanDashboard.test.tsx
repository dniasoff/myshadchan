import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { buildRecordPath } from "../entity360/entityPaths";
import type { Connection } from "../types";
import "../connections/entityDescriptor";
import { ShadchanDashboard } from "./ShadchanDashboard";

/**
 * Story 8.1 (AC-5) established the empty state; Story 8.5 (AC-7) replaces
 * the rest of the placeholder body with the real stat band + recently
 * active connections list, driven by the real FakeRest data provider (the
 * same pattern `ThreadList.test.tsx` uses for its own connection-scoped
 * queries) so a mutated filter/adapter fails a real assertion, not only
 * `make typecheck`.
 */

const CALLER_MEMBER_ID = 1;
const SHADCHANUS_ACCOUNT_ID = 9;

const seedCaller = (db: ReturnType<typeof generateData>) => {
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
};

const renderDashboard = async (
  configureDb: (db: ReturnType<typeof generateData>) => void = () => {},
) => {
  const db = generateData();
  seedCaller(db);
  db.connections = [];
  db.threads = [];
  db.thread_participants = [];
  db.messages = [];
  configureDb(db);
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ShadchanDashboard />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

const buildConnection = (
  overrides: Partial<Connection> & Pick<Connection, "id">,
): Connection => ({
  household_account_id: 1,
  shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
  status: "accepted",
  ended_at: null,
  proposed_by_account_id: 1,
  accepted_at: "2026-01-01T00:00:00Z",
  ended_by_account_id: null,
  created_at: "2026-01-01T00:00:00Z",
  household_account_name: "A Household",
  ...overrides,
});

describe("ShadchanDashboard — empty state (Story 8.1 AC-5, preserved by Story 8.5)", () => {
  it("renders the shadchanus workspace heading", async () => {
    // Arrange / Act
    const { screen } = await renderDashboard();

    // Assert
    await expect
      .element(screen.getByText("Your shadchanus workspace"))
      .toBeInTheDocument();
  });

  it("renders the calm empty state explaining nothing has arrived yet, with zero connections", async () => {
    // Arrange / Act
    const { screen } = await renderDashboard();

    // Assert — the exact Story 8.1 copy, reused verbatim (Task 6).
    await expect
      .element(
        screen.getByText(
          "Once you connect with a family, their conversations will appear here.",
        ),
      )
      .toBeInTheDocument();
  });

  it("never renders a household-only figure like a single or shidduch count", async () => {
    // Arrange / Act
    const { screen } = await renderDashboard();

    // Assert
    await expect.element(screen.getByText(/single/i)).not.toBeInTheDocument();
    await expect.element(screen.getByText(/shidduch/i)).not.toBeInTheDocument();
  });
});

describe("ShadchanDashboard — populated state (Story 8.5, AC-7)", () => {
  it("shows the accepted-connection count and links to /connections", async () => {
    // Arrange
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 1, household_account_name: "Klein Family" }),
        buildConnection({ id: 2, household_account_name: "Feldman Family" }),
      ];
    });

    // Assert
    await expect
      .element(screen.getByText("Connections", { exact: true }))
      .toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Klein Family/ });
    await expect.element(link).toBeInTheDocument();
    const statLink = screen.getByRole("link").first();
    expect(statLink.element().getAttribute("href")).toBe("/connections");
  });

  it("counts the exact accepted total past the 200-row page cap (review fix, M1 — reads `total`, not the capped array length)", async () => {
    // Arrange — 201 accepted connections: one more than the query's own
    // `perPage: 200`, so `acceptedConnections.length` (the fetched page)
    // would silently read 200 while the query's own `total` (PostgREST's
    // exact Content-Range count) reads 201.
    const { screen } = await renderDashboard((db) => {
      db.connections = Array.from({ length: 201 }, (_, index) =>
        buildConnection({
          id: index + 1,
          household_account_name: `Household ${index + 1}`,
        }),
      );
    });

    // Assert
    const label = screen.getByText("Connections", { exact: true });
    await expect.element(label).toBeInTheDocument();
    const tile = label.element().parentElement;
    expect(tile?.textContent).toBe("Connections201");
  });

  it("does not count an ENDED connection toward the accepted total or the recent list", async () => {
    // Arrange
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 1, household_account_name: "Klein Family" }),
        buildConnection({
          id: 2,
          household_account_name: "Ended Family",
          status: "ended",
          ended_at: "2026-02-01T00:00:00Z",
        }),
      ];
    });

    // Assert
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain("Ended Family");
  });

  it("orders the recent list by latest connection-scoped message, not by connection id or created_at", async () => {
    // Arrange — connection 1 was created first, but connection 2 has the
    // most recent message, so it must render FIRST.
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({
          id: 1,
          household_account_name: "Older Connection",
          created_at: "2026-01-01T00:00:00Z",
        }),
        buildConnection({
          id: 2,
          household_account_name: "Recently Active Connection",
          created_at: "2026-01-02T00:00:00Z",
        }),
      ];
      db.threads = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          account_id: null,
          connection_id: 2,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-02T00:00:00Z",
        },
      ];
      db.messages = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          thread_id: 1,
          sender_member_id: CALLER_MEMBER_ID,
          body: "An old message",
          created_at: "2026-01-03T00:00:00Z",
        },
        {
          id: 2,
          account_id: null,
          connection_id: 2,
          thread_id: 2,
          sender_member_id: CALLER_MEMBER_ID,
          body: "A brand new message",
          created_at: "2026-01-10T00:00:00Z",
        },
      ];
    });

    // Assert
    await expect
      .element(screen.getByText("Recently Active Connection", { exact: true }))
      .toBeInTheDocument();
    const names = screen
      .getByRole("link")
      .elements()
      .filter((element) =>
        (element.getAttribute("href") ?? "").startsWith("/connections/"),
      )
      .map((element) => element.textContent ?? "");
    expect(names[0]).toContain("Recently Active Connection");
    expect(names[1]).toContain("Older Connection");
  });

  it("counts an unread conversation once per connection, using Story 7.5's own unread definition", async () => {
    // Arrange (review fix, F4 — not falsifiable before): a single
    // connection/thread/message fixture cannot tell `unreadConnectionIds.size`
    // apart from `allThreads.length` or `unreadThreadIds.size` — all three
    // equal 1. This fixture gives connection 1 TWO unread threads (so
    // per-thread and per-connection counting diverge) and connection 2 one
    // thread the caller has already read past (so "ignoring read state
    // entirely" diverges too). The correct count is 1 (one connection has
    // unread activity); `allThreads.length` would read 3, and
    // `unreadThreadIds.size` (per thread, not per connection) would read 2.
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 1, household_account_name: "Klein Family" }),
        buildConnection({ id: 2, household_account_name: "Feldman Family" }),
      ];
      db.threads = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 3,
          account_id: null,
          connection_id: 2,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.thread_participants = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          thread_id: 1,
          member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
          last_read_at: null,
        },
        {
          id: 2,
          account_id: null,
          connection_id: 1,
          thread_id: 2,
          member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
          last_read_at: null,
        },
        {
          id: 3,
          account_id: null,
          connection_id: 2,
          thread_id: 3,
          member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
          // Read AFTER the message below — thread 3 is NOT unread.
          last_read_at: "2026-01-05T00:00:00Z",
        },
      ];
      db.messages = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          thread_id: 1,
          sender_member_id: null,
          body: "Any updates?",
          created_at: "2026-01-02T00:00:00Z",
        },
        {
          id: 2,
          account_id: null,
          connection_id: 1,
          thread_id: 2,
          sender_member_id: null,
          body: "A second unread thread on the same connection",
          created_at: "2026-01-03T00:00:00Z",
        },
        {
          id: 3,
          account_id: null,
          connection_id: 2,
          thread_id: 3,
          sender_member_id: null,
          body: "Already read",
          created_at: "2026-01-01T12:00:00Z",
        },
      ];
    });

    // Assert
    await expect
      .element(screen.getByText("Unread conversations"))
      .toBeInTheDocument();
    const unreadLabel = screen.getByText("Unread conversations", {
      exact: true,
    });
    const segment = unreadLabel.element().parentElement;
    expect(segment?.textContent).toBe("Unread conversations1");
  });

  // UX/mobile audit fix: "has unread messages" used to be an 8px
  // `aria-hidden` dot and nothing else, so the distinction was unavailable to
  // screen readers and carried by colour alone for everyone else.
  it("gives the unread dot a text equivalent, and renders none on a read connection", async () => {
    // Arrange — connection 1 has an unread thread; connection 2 has one the
    // caller has already read past.
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 1, household_account_name: "Klein Family" }),
        buildConnection({ id: 2, household_account_name: "Feldman Family" }),
      ];
      db.threads = [1, 2].map((id) => ({
        id,
        account_id: null,
        connection_id: id,
        subject_type: "relationship" as const,
        subject_id: null,
        visibility: "open" as const,
        created_by_member_id: CALLER_MEMBER_ID,
        created_at: "2026-01-01T00:00:00Z",
      }));
      db.thread_participants = [
        {
          id: 1,
          account_id: null,
          connection_id: 1,
          thread_id: 1,
          member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
          last_read_at: null,
        },
        {
          id: 2,
          account_id: null,
          connection_id: 2,
          thread_id: 2,
          member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-01T00:00:00Z",
          // Read AFTER the message below — connection 2 is NOT unread.
          last_read_at: "2026-01-05T00:00:00Z",
        },
      ];
      db.messages = [1, 2].map((id) => ({
        id,
        account_id: null,
        connection_id: id,
        thread_id: id,
        sender_member_id: null,
        body: "Any updates?",
        created_at: "2026-01-02T00:00:00Z",
      }));
    });

    // Assert
    const unreadLink = screen.getByRole("link", { name: /Klein Family/ });
    await expect.element(unreadLink).toBeInTheDocument();
    expect(unreadLink.element().textContent).toContain("Unread messages");

    const readLink = screen.getByRole("link", { name: /Feldman Family/ });
    expect(readLink.element().textContent).not.toContain("Unread messages");
  });

  it("links each recent connection through RecordLink, resolving to the real Connection 360 route", async () => {
    // Arrange
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 42, household_account_name: "Klein Family" }),
      ];
    });

    // Assert
    const link = screen.getByRole("link", { name: /Klein Family/ });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      buildRecordPath("connections", 42),
    );
  });

  it("falls back to a connection's own created_at when it has no messages yet — the newer connection (by created_at) renders first", async () => {
    // Arrange — mirrors sortByLatestActivity's own fallback branch, exercised
    // here through the real component rather than a direct unit test (that
    // function is not exported — see ShadchanDashboard.tsx's own comment on
    // why, react-refresh/only-export-components).
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({
          id: 1,
          household_account_name: "Older Connection",
          created_at: "2026-01-01T00:00:00Z",
        }),
        buildConnection({
          id: 2,
          household_account_name: "Newer Connection",
          created_at: "2026-01-05T00:00:00Z",
        }),
      ];
    });

    // Assert
    await expect
      .element(screen.getByText("Newer Connection", { exact: true }))
      .toBeInTheDocument();
    const names = screen
      .getByRole("link")
      .elements()
      .filter((element) =>
        (element.getAttribute("href") ?? "").startsWith("/connections/"),
      )
      .map((element) => element.textContent ?? "");
    expect(names[0]).toContain("Newer Connection");
    expect(names[1]).toContain("Older Connection");
  });
});

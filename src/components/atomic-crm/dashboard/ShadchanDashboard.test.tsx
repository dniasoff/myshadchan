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
    // Arrange — the caller has never read this thread's message.
    const { screen } = await renderDashboard((db) => {
      db.connections = [
        buildConnection({ id: 1, household_account_name: "Klein Family" }),
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

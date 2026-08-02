import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { Identifier } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Connection, Interaction, MyContext, Task } from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect import — registers the REAL connectionsDescriptor at module
// scope, mirroring the real boot sequence (`connections/index.ts` imports
// `./entityDescriptor` as its first line).
import "./entityDescriptor";

/**
 * Story 8.5, Task 9 — descriptor/show coverage for `connections`, following
 * the exact pattern `shadchanim/entityDescriptor.test.tsx` /
 * `references/entityDescriptor.test.tsx` established: a real `EntityShow`
 * render through `buildEntityRoutes`, driven by the real FakeRest data
 * provider, so a mutated adapter prop or a wrong target_type fails a real
 * assertion, not only `make typecheck`.
 */

const CALLER_MEMBER_ID = 1;
const SHADCHANUS_ACCOUNT_ID = 9;

const contextsFor = (): MyContext[] => [
  {
    account_id: SHADCHANUS_ACCOUNT_ID,
    kind: "shadchanus",
    name: "Golden Matches Shadchanus",
    role: "shadchan",
    is_active: true,
  },
];

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
  household_account_name: "Klein Family",
  ...overrides,
});

const renderConnectionShow = async (
  connectionId: Identifier,
  configureDb: (db: ReturnType<typeof generateData>) => void = () => {},
  overrideDataProvider: (
    base: CrmDataProvider,
  ) => Partial<CrmDataProvider> = () => ({}),
) => {
  const db = generateData();
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
  db.connections = [buildConnection({ id: connectionId })];
  db.threads = [];
  db.thread_participants = [];
  db.messages = [];
  configureDb(db);
  const baseDataProvider = createDataProvider({ db, latency: 0, silent: true });
  const dataProvider: CrmDataProvider = {
    ...baseDataProvider,
    ...overrideDataProvider(baseDataProvider),
  };
  const contexts = contextsFor();
  dataProvider.getMyContexts = vi.fn().mockResolvedValue(contexts);
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);

  const screen = await render(
    <TestMemoryRouter initialEntries={[`/connections/${connectionId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/connections/*"
            element={
              <ResourceContextProvider value="connections">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("connectionsDescriptor — tab strip order (Story 8.5, AC-3)", () => {
  it("renders all five canonical tabs, in canonical order, on the rendered strip", async () => {
    // Act
    const { screen } = await renderConnectionShow(1);
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();

    // Assert
    const names = screen
      .getByRole("tab")
      .elements()
      .map((element) => element.textContent?.trim());
    expect(names).toEqual([
      "Overview",
      "Discussions",
      "Notes",
      "Tasks",
      "Activity",
    ]);
  });
});

describe("connectionsDescriptor — identity header and stat band (Story 8.5, AC-2)", () => {
  it("shows the connected household's own name and an Accepted status", async () => {
    // Act
    const { screen } = await renderConnectionShow(1);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Klein Family" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Accepted", { exact: true }))
      .toBeInTheDocument();
  });

  it("shows Ended with the end date for an ended connection", async () => {
    // Act
    const { screen } = await renderConnectionShow(1, (db) => {
      db.connections = [
        buildConnection({
          id: 1,
          status: "ended",
          ended_at: "2026-03-01T00:00:00Z",
        }),
      ];
    });

    // Assert
    await expect
      .element(screen.getByText(/Ended 1 Mar 2026/))
      .toBeInTheDocument();
  });

  it("renders the redt-sent count derived from connection-scoped relationship threads, never from a bare 0", async () => {
    // Act
    const { screen } = await renderConnectionShow(1, (db) => {
      db.threads = [
        {
          id: 501,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-02T00:00:00Z",
        },
      ];
    });

    // Assert — the stat tile's own segment reads exactly "1", scoped to the
    // "Redts sent" label's own tile so a bare getByText("1") elsewhere
    // cannot coincidentally satisfy this.
    const label = screen.getByText("Redts sent", { exact: true });
    await expect.element(label).toBeInTheDocument();
    const tile = label.element().parentElement;
    expect(tile?.textContent).toBe("Redts sent1");
  });

  it("counts the exact total, not just the fetched page (review fix, M1 — reads `total`, not `data.length`)", async () => {
    // Arrange — the stat band requests `perPage: 1` (it never needs the
    // rows themselves, only a count), so `data.length` would silently read
    // 1 regardless of how many redts were actually sent. Two threads here
    // must still render "2", proving the count comes from the query's own
    // `total` (PostgREST's exact Content-Range count), not the capped page.
    const { screen } = await renderConnectionShow(1, (db) => {
      db.threads = [
        {
          id: 501,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-02T00:00:00Z",
        },
        {
          id: 502,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-03T00:00:00Z",
        },
      ];
    });

    // Assert
    const label = screen.getByText("Redts sent", { exact: true });
    await expect.element(label).toBeInTheDocument();
    const tile = label.element().parentElement;
    expect(tile?.textContent).toBe("Redts sent2");
  });

  it("never counts a DIFFERENT connection's relationship threads (review fix, F5 — AD-20 cross-connection confusion)", async () => {
    // Arrange — a single-connection fixture cannot tell "this connection's
    // threads" apart from "every connection's threads": both read 1. This
    // fixture adds a SECOND connection with its own redt thread, so a stat
    // band that dropped `connection_id` from its filter would read 2, not 1.
    const { screen } = await renderConnectionShow(1, (db) => {
      db.connections = [
        ...db.connections,
        {
          id: 2,
          household_account_id: 2,
          shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
          status: "accepted",
          ended_at: null,
          proposed_by_account_id: 2,
          accepted_at: "2026-01-01T00:00:00Z",
          ended_by_account_id: null,
          created_at: "2026-01-01T00:00:00Z",
          household_account_name: "A Different Household",
        },
      ];
      db.threads = [
        {
          id: 501,
          account_id: null,
          connection_id: 1,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-02T00:00:00Z",
        },
        {
          id: 502,
          account_id: null,
          connection_id: 2,
          subject_type: "relationship",
          subject_id: null,
          visibility: "open",
          created_by_member_id: CALLER_MEMBER_ID,
          created_at: "2026-01-02T00:00:00Z",
        },
      ];
    });

    // Assert — connection 1's own page still reads exactly 1, never 2.
    const label = screen.getByText("Redts sent", { exact: true });
    await expect.element(label).toBeInTheDocument();
    const tile = label.element().parentElement;
    expect(tile?.textContent).toBe("Redts sent1");
  });
});

describe("connectionsDescriptor — right rail actions (Story 8.5, AC-4/AC-5)", () => {
  it("shows an enabled 'Send a redt' button and an 'End connection' button for an accepted connection", async () => {
    // Act
    const { screen } = await renderConnectionShow(1);

    // Assert
    const sendButton = screen.getByRole("button", { name: "Send a redt" });
    await expect.element(sendButton).toBeInTheDocument();
    expect(sendButton.element().hasAttribute("disabled")).toBe(false);
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .toBeInTheDocument();
  });

  it("disables 'Send a redt' with an explanatory message once the connection has ended, and hides 'End connection'", async () => {
    // Act
    const { screen } = await renderConnectionShow(1, (db) => {
      db.connections = [
        buildConnection({
          id: 1,
          status: "ended",
          ended_at: "2026-03-01T00:00:00Z",
        }),
      ];
    });

    // Assert
    const sendButton = screen.getByRole("button", { name: "Send a redt" });
    await expect.element(sendButton).toBeInTheDocument();
    expect(sendButton.element().hasAttribute("disabled")).toBe(true);
    await expect
      .element(
        screen.getByText(
          "This connection has ended — a redt can no longer be sent through it.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .not.toBeInTheDocument();
  });
});

describe("connectionsDescriptor — the real Notes tab is scoped to targetType='connection' (Story 8.5, AC-9)", () => {
  const buildNote = (
    overrides: Partial<Interaction> & Pick<Interaction, "id">,
  ): Interaction => ({
    account_id: SHADCHANUS_ACCOUNT_ID,
    target_type: "connection",
    target_id: 1,
    scope: "account",
    kind: "note",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this connection's own note, never a note filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderConnectionShow(1, (db) => {
      db.interactions = [
        ...db.interactions,
        buildNote({
          id: 90701,
          target_id: 1,
          body: "This Connection's Own Note",
        }),
        buildNote({
          id: 90702,
          target_id: 9999999,
          body: "A Different Connection's Note",
        }),
        buildNote({
          id: 90703,
          target_type: "shadchan",
          target_id: 1,
          body: "Same Id Wrong Type Note",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Notes" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Connection's Own Note"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Connection's Note",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Note",
    );
  });
});

describe("connectionsDescriptor — the real Tasks tab is scoped to targetType='connection' (Story 8.5, AC-9)", () => {
  const buildTask = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
    type: "reminder",
    text: "placeholder",
    due_date: "2026-02-01T00:00:00Z",
    done_date: null,
    target_type: "connection",
    target_id: 1,
    ...overrides,
  });

  it("renders this connection's own task, never a task filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderConnectionShow(1, (db) => {
      db.tasks = [
        ...db.tasks,
        buildTask({
          id: 90801,
          target_id: 1,
          text: "This Connection's Own Task",
        }),
        buildTask({
          id: 90802,
          target_id: 9999999,
          text: "A Different Connection's Task",
        }),
        buildTask({
          id: 90803,
          target_type: "shadchan",
          target_id: 1,
          text: "Same Id Wrong Type Task",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Tasks" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Connection's Own Task"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Connection's Task",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Task",
    );
  });
});

describe("connectionsDescriptor — the Discussions tab reuses ThreadList, scoped to THIS connection (Story 8.5, AC-3)", () => {
  it("lists a thread scoped to this connection and starts a new one via createThread()", async () => {
    const { screen, dataProvider } = await renderConnectionShow(1);

    // Act
    await screen.getByRole("tab", { name: "Discussions" }).click();
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
      connection_id: 1,
      subject_type: "relationship",
      subject_id: null,
    });
  });
});

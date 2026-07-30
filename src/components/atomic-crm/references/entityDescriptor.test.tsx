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
import type {
  Interaction,
  MemberRole,
  MyContext,
  ReferenceLink,
  Shidduch,
  Task,
} from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { buildRecordPath } from "../entity360/entityPaths";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect imports — register the REAL referencesDescriptor AND the real
// shidduchimDescriptor, exactly like `references/index.ts` and
// `shidduchim/index.ts` both do at boot (`RecordLink` needs the shidduchim
// descriptor registered to resolve the Shidduchim tab's links).
import "../shidduchim/entityDescriptor";
import "./entityDescriptor";

/**
 * Story 5.10, Task 3/5: adapter-wrapper and tab-rendering coverage.
 * `shadchanim/entityDescriptor.test.tsx` / `singles/entityDescriptor.test.tsx`'s
 * pattern applied to `references` — a real `EntityShow` render through
 * `buildEntityRoutes`, driven by the real FakeRest data provider, so a
 * mutated adapter prop or a mis-wired relationship fails a real assertion
 * instead of only `make typecheck`.
 */

const contextsFor = (role: MemberRole = "parent_admin"): MyContext[] => [
  {
    account_id: 1,
    kind: "household",
    name: "Fixture Household",
    role,
    is_active: true,
  },
];

const renderReferenceShow = async (
  configureDb: (
    db: ReturnType<typeof generateData>,
    referenceId: Identifier,
  ) => void = () => {},
  role: MemberRole = "parent_admin",
) => {
  const db = generateData();
  const referenceId = db.references[0].id;
  configureDb(db, referenceId);
  const dataProvider: CrmDataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
  });
  const contexts = contextsFor(role);
  // A real refetch (react-query's default `refetchOnMount`) would otherwise
  // overwrite the seeded cache below with whatever FakeRest's own
  // account_members fixture resolves — silently reverting `role` to
  // "parent_admin" regardless of what this helper was asked for (Story 6.2's
  // Tasks-tab `visibleTo` tests are the first callers to pass a non-default
  // role here).
  dataProvider.getMyContexts = vi.fn().mockResolvedValue(contexts);
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);

  const screen = await render(
    <TestMemoryRouter initialEntries={[`/references/${referenceId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/references/*"
            element={
              <ResourceContextProvider value="references">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, referenceId, dataProvider };
};

const buildLink = (
  overrides: Partial<ReferenceLink> &
    Pick<ReferenceLink, "id" | "reference_id">,
): ReferenceLink => ({
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildShidduch = (
  overrides: Partial<Shidduch> & Pick<Shidduch, "id" | "single_id">,
): Shidduch => ({
  account_id: 1,
  shadchan_id: null,
  name_en: null,
  name_he: null,
  pipeline_state: "new",
  first_suggested_by: null,
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-03-15",
  close_reason: null,
  origin: "manual",
  owner_member_id: null,
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("referencesDescriptor — tab strip order (Story 5.10, AC 4)", () => {
  it("renders all seven canonical tabs, in canonical order, on the rendered strip (not merely the descriptor literal)", async () => {
    // Act
    const { screen } = await renderReferenceShow();
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();

    // Assert — Shidduchim renders THIRD, not last: `mergeEntityTabs` would
    // append a `relationships`-declared tab after every explicit entry, so
    // this only passes because the descriptor declares it explicitly at
    // that position.
    const names = screen
      .getByRole("tab")
      .elements()
      .map((element) => element.textContent?.trim());
    expect(names).toEqual([
      "Overview",
      "Conversations",
      "Shidduchim",
      "Notes",
      "Tasks",
      "Activity",
      "Assistant",
    ]);
  });
});

describe("referencesDescriptor — the real Tasks tab's visibleTo (Story 6.2, AC 10)", () => {
  it("shows the Tasks tab to a parent_admin viewer", async () => {
    // Act
    const { screen } = await renderReferenceShow(undefined, "parent_admin");

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Tasks" }))
      .toBeInTheDocument();
  });

  it("never renders the Tasks tab (or its label anywhere) for a single viewer — RLS empties the table, this hides the dead shell", async () => {
    // Act
    const { screen } = await renderReferenceShow(undefined, "single");

    // Assert — the Overview anchor proves the tab strip has actually
    // mounted before the negative assertion runs.
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Tasks" }))
      .not.toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain("Tasks");
  });
});

describe("referencesDescriptor — identity header adapter renders the real record (Story 5.10)", () => {
  it("shows the reference's own name (ReferenceIdentityHeader)", async () => {
    // Arrange
    const { screen } = await renderReferenceShow((db, id) => {
      db.references = db.references.map((reference) =>
        reference.id === id
          ? { ...reference, name_en: "Distinctive Reference Name" }
          : reference,
      );
    });

    // Assert
    await expect
      .element(
        screen.getByRole("heading", { name: "Distinctive Reference Name" }),
      )
      .toBeInTheDocument();
  });
});

describe("referencesDescriptor — the Overview tab renders the identity-fact block (Story 5.10, AC 4)", () => {
  it("renders relationship, phone, school and graduation year, relocated out of the header", async () => {
    // Arrange
    const { screen } = await renderReferenceShow((db, id) => {
      db.references = db.references.map((reference) =>
        reference.id === id
          ? {
              ...reference,
              relationship: "Rebbi",
              phone: "555-0100",
              school: "Ner Yisroel",
              grad_year: 2010,
            }
          : reference,
      );
    });

    // Act
    await screen.getByRole("tab", { name: "Overview" }).click();

    // Assert
    await expect.element(screen.getByText("Rebbi")).toBeInTheDocument();
    await expect.element(screen.getByText("555-0100")).toBeInTheDocument();
    await expect.element(screen.getByText("Ner Yisroel")).toBeInTheDocument();
    await expect.element(screen.getByText("2010")).toBeInTheDocument();
  });
});

describe("referencesDescriptor — the Shidduchim tab renders RelatedRecordsTab over reference_links_summary (Story 5.10, Task 3)", () => {
  it("renders one RecordLink per OTHER linked shidduch, each with a resolved label (linkLabel supplied)", async () => {
    const { screen, referenceId } = await renderReferenceShow((db, id) => {
      const singleId = db.singles[0].id;
      db.shidduchim = [
        ...db.shidduchim,
        buildShidduch({
          id: 90910,
          single_id: singleId,
          name_en: "Distinctive Shidduch A",
        }),
        buildShidduch({
          id: 90911,
          single_id: singleId,
          name_en: "Distinctive Shidduch B",
        }),
      ];
      db.reference_links = [
        ...db.reference_links.filter((link) => link.reference_id !== id),
        buildLink({ id: 90920, reference_id: id, shidduchim_id: 90910 }),
        buildLink({ id: 90921, reference_id: id, shidduchim_id: 90911 }),
        // A link with no shidduch at all must render no row.
        buildLink({ id: 90922, reference_id: id, shidduchim_id: null }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Shidduchim" }).click();

    // Assert
    const linkA = screen.getByRole("link", { name: "Distinctive Shidduch A" });
    const linkB = screen.getByRole("link", { name: "Distinctive Shidduch B" });
    await expect.element(linkA).toBeInTheDocument();
    await expect.element(linkB).toBeInTheDocument();
    expect(linkA.element().getAttribute("href")).toBe(
      buildRecordPath("shidduchim", 90910),
    );
    expect(linkB.element().getAttribute("href")).toBe(
      buildRecordPath("shidduchim", 90911),
    );
    // Exactly two rows inside the tab panel — the null-shidduchim link
    // contributes none. Scoped to the panel (not the whole screen) so the
    // identity header's own EditButton `<a>` — which persists across every
    // tab — is never counted.
    const tabPanel = screen.container.querySelector('[role="tabpanel"]');
    expect(tabPanel?.querySelectorAll("a")).toHaveLength(2);
    expect(referenceId).toBeDefined();
  });
});

describe("referencesDescriptor — the real Notes tab is scoped to targetType='reference' (Story 5.10)", () => {
  const buildNote = (
    overrides: Partial<Interaction> & Pick<Interaction, "id">,
  ): Interaction => ({
    account_id: 1,
    target_type: "reference",
    target_id: 1,
    scope: "account",
    kind: "note",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this reference's own note, never a note filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderReferenceShow((db, referenceId) => {
      db.interactions = [
        ...db.interactions,
        buildNote({
          id: 90701,
          target_type: "reference",
          target_id: referenceId,
          body: "This Reference's Own Note",
        }),
        buildNote({
          id: 90702,
          target_type: "reference",
          target_id: 9999999,
          body: "A Different Reference's Note",
        }),
        buildNote({
          id: 90703,
          target_type: "shidduch",
          target_id: referenceId,
          scope: "shidduch",
          body: "Same Id Wrong Type Note",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Notes" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Reference's Own Note"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Reference's Note",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Note",
    );
  });
});

describe("referencesDescriptor — the real Tasks tab is scoped to targetType='reference' (Story 5.10)", () => {
  const buildTask = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
    type: "reminder",
    text: "placeholder",
    due_date: "2026-02-01T00:00:00Z",
    done_date: null,
    target_type: "reference",
    target_id: 1,
    ...overrides,
  });

  it("renders this reference's own task, never a task filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderReferenceShow((db, referenceId) => {
      db.tasks = [
        ...db.tasks,
        buildTask({
          id: 90801,
          target_type: "reference",
          target_id: referenceId,
          text: "This Reference's Own Task",
        }),
        buildTask({
          id: 90802,
          target_type: "reference",
          target_id: 9999999,
          text: "A Different Reference's Task",
        }),
        buildTask({
          id: 90803,
          target_type: "shidduch",
          target_id: referenceId,
          text: "Same Id Wrong Type Task",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Tasks" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Reference's Own Task"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Reference's Task",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Task",
    );
  });
});

describe("referencesDescriptor — the Conversations tab renders RepeatRecognitionPanel + ReferenceCallLog (Story 5.10)", () => {
  it("renders the call log for this reference's own links", async () => {
    const { screen } = await renderReferenceShow((db, id) => {
      db.reference_links = [
        ...db.reference_links.filter((link) => link.reference_id !== id),
        buildLink({
          id: 90930,
          reference_id: id,
          shidduchim_id: db.shidduchim[0]?.id ?? null,
          call_status: "answered",
          what_they_said: "Distinctive Call Log Text",
        }),
      ];
    });

    // Act — Conversations is the default second tab; click it explicitly to
    // be independent of default-tab selection.
    await screen.getByRole("tab", { name: "Conversations" }).click();

    // Assert
    await expect
      .element(screen.getByText("Distinctive Call Log Text"))
      .toBeInTheDocument();
  });
});

describe("referencesDescriptor — the Assistant tab renders ResearchAssistantPanel, unchanged (Story 5.10)", () => {
  it("shows the paid upsell for an unentitled account, never a blank tab", async () => {
    const { screen } = await renderReferenceShow();

    // Act
    await screen.getByRole("tab", { name: "Assistant" }).click();

    // Assert
    await expect
      .element(screen.getByText("Research assistant"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Paid")).toBeInTheDocument();
  });
});

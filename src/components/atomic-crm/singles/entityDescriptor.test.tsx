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
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type {
  EntityFile,
  Interaction,
  MemberRole,
  MyContext,
  Shidduch,
  Task,
} from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { buildRecordPath } from "../entity360/entityPaths";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect imports — register the REAL singlesDescriptor AND the real
// shidduchimDescriptor, exactly like `singles/index.ts` and
// `shidduchim/index.ts` both do at boot (a real app has both registered by
// the time a viewer opens a single's Shidduchim tab). The second import is
// required for the AC-8 test below: `RecordLink` degrades to an inert
// `<span>` — never throws — when its target resource has no registered
// descriptor, so without it the "no `recordRepresentation`" defect (review
// finding 1) would be masked by a *different* missing-descriptor failure
// mode instead of proven.
import "../shidduchim/entityDescriptor";
import "./entityDescriptor";

/**
 * Story 5.8 review fix (findings 1 and 2). The original diff shipped
 * `entityDescriptorRegions.tsx` and `SingleOverviewTab.tsx` with zero test
 * coverage — every adapter compiled and rendered, but nothing asserted
 * WHAT it rendered. Proven exploitable in review: mutating
 * `SingleNotesTab`'s `targetType="single"` to `"shidduch"`, or any of
 * `ResumeUpload`/`ResumeVersionList`/`PhotoTabContent`'s `singleId` to
 * `shidduchimId`, left `make typecheck` and the full suite green. This file
 * is `shidduchim/entityDescriptor.test.tsx`'s pattern applied to `singles`.
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

const renderSingleShow = async (
  configureDb: (
    db: ReturnType<typeof generateData>,
    singleId: Identifier,
  ) => void = () => {},
  role: MemberRole = "parent_admin",
) => {
  const db = generateData();
  const singleId = db.singles[0].id;
  configureDb(db, singleId);
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
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
    <TestMemoryRouter initialEntries={[`/singles/${singleId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/singles/*"
            element={
              <ResourceContextProvider value="singles">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, singleId, dataProvider };
};

describe("singlesDescriptor — tab strip order (Story 5.8, AC 6)", () => {
  it("renders all eight canonical tabs, in canonical order, on the rendered strip (not merely the descriptor literal)", async () => {
    // Act
    const { screen } = await renderSingleShow();
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
      "Resume",
      "Photo",
      "Files",
      "Shidduchim",
      "Notes",
      "Tasks",
      "Activity",
    ]);
  });
});

describe("singlesDescriptor — the real Tasks tab's visibleTo (Story 6.2, AC 10)", () => {
  it("shows the Tasks tab to a parent_admin viewer", async () => {
    // Act
    const { screen } = await renderSingleShow(undefined, "parent_admin");

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Tasks" }))
      .toBeInTheDocument();
  });

  it("never renders the Tasks tab (or its label anywhere) for a single viewer — RLS empties the table, this hides the dead shell", async () => {
    // Act
    const { screen } = await renderSingleShow(undefined, "single");

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
  redt_date: "2026-01-01",
  close_reason: null,
  origin: "manual",
  owner_member_id: null,
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("singlesDescriptor — the real Shidduchim tab shows a name, never a bare id (Story 5.8, AC 8; review finding 1)", () => {
  it("renders this single's own shidduch by name, with a working link to its 360", async () => {
    // Arrange — `shidduchim` declares no `recordRepresentation`
    // (`shidduchim/index.ts`), so before the fix `RelatedRecordsTab`'s
    // `getRecordRepresentation` fallback rendered ra-core's bare `#{id}`.
    const shidduchId = 90100;
    const { screen } = await renderSingleShow((db, singleId) => {
      db.shidduchim = [
        ...db.shidduchim,
        buildShidduch({
          id: shidduchId,
          single_id: singleId,
          name_en: "Distinctive Shidduch Name",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Shidduchim" }).click();

    // Assert — a human label...
    const link = screen.getByRole("link", {
      name: "Distinctive Shidduch Name",
    });
    await expect.element(link).toBeInTheDocument();
    // ...linking to the real shidduch 360...
    expect(link.element().getAttribute("href")).toBe(
      buildRecordPath("shidduchim", shidduchId),
    );
    // ...never ra-core's bare "#{id}" fallback (the pre-fix regression).
    expect(screen.container.textContent ?? "").not.toContain(`#${shidduchId}`);
  });
});

describe("singlesDescriptor — the real Files tab is scoped to targetType='single' (Story 5.8, AC 7)", () => {
  const buildFile = (
    overrides: Partial<EntityFile> & Pick<EntityFile, "id">,
  ): EntityFile => ({
    account_id: 1,
    target_type: "single",
    target_id: 1,
    storage_path: "1/single/1/file.pdf",
    file_name: "file.pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    visibility: "shared",
    uploaded_by_member_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this single's own file, never a row filed under a different target_id or a different targetType sharing this numeric id", async () => {
    // Arrange — mutating `SingleFilesTab`'s `targetType`/`targetId` to a
    // wrong-but-still-valid value previously left the whole suite green.
    const { screen } = await renderSingleShow((db, singleId) => {
      db.entity_files = [
        buildFile({
          id: 90301,
          target_type: "single",
          target_id: singleId,
          file_name: "This Single's Own File.pdf",
        }),
        buildFile({
          id: 90302,
          target_type: "single",
          target_id: 9999999,
          file_name: "Other Single's File.pdf",
        }),
        buildFile({
          id: 90303,
          target_type: "shidduch",
          target_id: singleId,
          file_name: "Same Id Wrong Type File.pdf",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Files" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Single's Own File.pdf"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "Other Single's File.pdf",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type File.pdf",
    );
  });
});

describe("singlesDescriptor — the real Notes tab is scoped to targetType='single' (Story 5.8, AC 7; review finding 2)", () => {
  const buildNote = (
    overrides: Partial<Interaction> & Pick<Interaction, "id">,
  ): Interaction => ({
    account_id: 1,
    target_type: "single",
    target_id: 1,
    scope: "account",
    kind: "note",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this single's own note, never a note filed under a different target_id or a different targetType sharing this numeric id", async () => {
    // Arrange — this is the exact review-proven mutation: `SingleNotesTab`'s
    // `targetType="single"` swapped to `"shidduch"` left the whole suite
    // green before this test existed.
    const { screen } = await renderSingleShow((db, singleId) => {
      db.interactions = [
        ...db.interactions,
        buildNote({
          id: 90201,
          target_type: "single",
          target_id: singleId,
          body: "This Single's Own Note",
        }),
        buildNote({
          id: 90202,
          target_type: "single",
          target_id: 9999999,
          body: "A Different Single's Note",
        }),
        buildNote({
          id: 90203,
          target_type: "shidduch",
          target_id: singleId,
          scope: "shidduch",
          body: "Same Id Wrong Type Note",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Notes" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Single's Own Note"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Single's Note",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Note",
    );
  });
});

describe("singlesDescriptor — the real Tasks tab is scoped to targetType='single' (Story 5.8, AC 7)", () => {
  const buildTask = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
    type: "reminder",
    text: "placeholder",
    due_date: "2026-02-01T00:00:00Z",
    done_date: null,
    target_type: "single",
    target_id: 1,
    ...overrides,
  });

  it("renders this single's own task, never a task filed under a different target_id or a different targetType sharing this numeric id", async () => {
    // Arrange
    const { screen } = await renderSingleShow((db, singleId) => {
      db.tasks = [
        ...db.tasks,
        buildTask({
          id: 90401,
          target_type: "single",
          target_id: singleId,
          text: "This Single's Own Task",
        }),
        buildTask({
          id: 90402,
          target_type: "single",
          target_id: 9999999,
          text: "A Different Single's Task",
        }),
        buildTask({
          id: 90403,
          target_type: "shidduch",
          target_id: singleId,
          text: "Same Id Wrong Type Task",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Tasks" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Single's Own Task"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Single's Task",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Task",
    );
  });
});

describe("singlesDescriptor — the real Activity tab is scoped to targetType='single' (Story 5.8, AC 7)", () => {
  const buildActivity = (
    overrides: Partial<Interaction> & Pick<Interaction, "id">,
  ): Interaction => ({
    account_id: 1,
    target_type: "single",
    target_id: 1,
    scope: "account",
    kind: "note",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this single's own activity, never a row filed under a different target_id or a different targetType sharing this numeric id", async () => {
    // Arrange
    const { screen } = await renderSingleShow((db, singleId) => {
      db.interactions = [
        ...db.interactions,
        buildActivity({
          id: 90501,
          target_type: "single",
          target_id: singleId,
          body: "This Single's Own Activity",
        }),
        buildActivity({
          id: 90502,
          target_type: "single",
          target_id: 9999999,
          body: "A Different Single's Activity",
        }),
        buildActivity({
          id: 90503,
          target_type: "shidduch",
          target_id: singleId,
          scope: "shidduch",
          body: "Same Id Wrong Type Activity",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Activity" }).click();

    // Assert
    await expect
      .element(screen.getByText("This Single's Own Activity"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Single's Activity",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Activity",
    );
  });
});

describe("singlesDescriptor — the real Resume tab mounts with { singleId }, never { shidduchimId } (Story 5.8, AC 3; review finding 2)", () => {
  it("creates the resumes row keyed by single_id after an upload through the Resume tab", async () => {
    // Arrange — this is the exact review-proven mutation:
    // `ResumeUpload`/`ResumeVersionList` called with `{ shidduchimId }`
    // instead of `{ singleId }` left `make typecheck` and the whole suite
    // green before this test existed.
    const file = new File(["bytes"], "single-resume.pdf", {
      type: "application/pdf",
    });
    const { screen, singleId, dataProvider } = await renderSingleShow();

    // Act
    await screen.getByRole("tab", { name: "Resume" }).click();
    await screen.getByLabelText("Upload a new version").upload(file);

    // Assert
    const { data } = await dataProvider.getList("resumes", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(1);
    expect(data[0].single_id).toBe(singleId);
    expect(data[0].shidduchim_id ?? null).toBeNull();
  });
});

describe("singlesDescriptor — the real Photo tab mounts with { singleId }, never { shidduchimId } (Story 5.8, AC 3; review finding 2)", () => {
  it("creates the resumes row keyed by single_id after an upload through the Photo tab", async () => {
    // Arrange
    const file = new File(["bytes"], "single-photo.jpg", {
      type: "image/jpeg",
    });
    const { screen, singleId, dataProvider } = await renderSingleShow();

    // Act
    await screen.getByRole("tab", { name: "Photo" }).click();
    await screen.getByLabelText("Upload a photo").upload(file);

    // Assert
    const { data } = await dataProvider.getList("resumes", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(1);
    expect(data[0].single_id).toBe(singleId);
    expect(data[0].shidduchim_id ?? null).toBeNull();
  });
});

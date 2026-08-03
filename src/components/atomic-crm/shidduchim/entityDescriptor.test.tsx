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
  Resume,
  Task,
} from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { buildTabPath } from "../entity360/entityPaths";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect import — registers the REAL shidduchimDescriptor, exactly like
// `<entity>/index.ts` does at boot. This file proves the real registered
// object's `medical` tab wiring, not a synthetic fixture — the generic
// denial mechanism itself (a viewer without the allowed role never sees a
// restricted tab or triggers its render) is already proven once, in general,
// by `entity360/EntityShow.permissions.test.tsx`.
import "./entityDescriptor";

/**
 * Story 5.5, AC 2 / AC 5: `shidduchimDescriptor`'s real `medical` tab entry
 * carries `visibleTo: ["parent_admin", "self_manager"]`. Mounted through the
 * real FakeRest data provider (not a mock) because the shidduch's Overview
 * tab — the default landing tab — performs several of its own fetches
 * (`ShidduchOverviewTab.tsx`: redts, shadchanim, shidduch_schools), the same
 * "real provider, not a mock" reasoning `PhotoTab.test.tsx` and
 * `MedicalTab.test.tsx` use for their own deep component trees.
 */

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const renderShidduchShow = async (
  role?: MemberRole,
  configureDb: (
    db: ReturnType<typeof generateData>,
    shidduchId: Identifier,
  ) => void = () => {},
) => {
  const db = generateData();
  const shidduchId = db.shidduchim[0].id;
  configureDb(db, shidduchId);
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  const contexts = role ? [contextFor(role)] : [];
  dataProvider.getMyContexts = vi.fn().mockResolvedValue(contexts);
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);

  const screen = await render(
    <TestMemoryRouter initialEntries={[`/shidduchim/${shidduchId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/shidduchim/*"
            element={
              <ResourceContextProvider value="shidduchim">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen };
};

describe("shidduchimDescriptor — the real medical tab's visibleTo (Story 5.5, AC 2)", () => {
  it.each(["parent_admin", "self_manager"] as const)(
    "shows the Medical tab to a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderShidduchShow(role);

      // Assert
      await expect
        .element(screen.getByRole("tab", { name: "Medical" }))
        .toBeInTheDocument();
    },
  );

  it.each(["single", "helper"] as const)(
    "never renders the Medical tab (or its label anywhere) for a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderShidduchShow(role);

      // Assert — absent from the DOM entirely (AC 2), not merely un-selected.
      await expect
        .element(screen.getByRole("tab", { name: "Overview" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("tab", { name: "Medical" }))
        .not.toBeInTheDocument();
      expect(screen.container.textContent ?? "").not.toContain("Medical");
    },
  );

  it("a shadchan viewer never sees the Medical tab (no membership path into a household row, AD-20)", async () => {
    // Act
    const { screen } = await renderShidduchShow("shadchan");

    // Assert — the Overview anchor proves the tab strip has actually
    // mounted before the negative assertion runs; without it, `not
    // .toBeInTheDocument()` on "Medical" is satisfied trivially at t=0
    // (before render), so this case would stay green even if `visibleTo`
    // were deleted from the descriptor entirely.
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .not.toBeInTheDocument();
  });

  it("an unresolved role (no active membership) never sees the Medical tab — AC 2(b), fails closed", async () => {
    // Act — no role at all, mirroring a caller whose active context resolved
    // but who holds no active membership in it (`useViewerRole()` returns
    // `role: undefined`, `isPending: false`). `EntityShow.tsx`'s own doc
    // comment states this must fail closed exactly like an insufficient
    // role; this is that behaviour asserted on the real registered
    // descriptor rather than assumed.
    const { screen } = await renderShidduchShow();

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .not.toBeInTheDocument();
  });
});

describe("shidduchimDescriptor — tab strip order (Story 5.6, AC 1 / AC 2; Story 7.1 appends Discussions)", () => {
  it("renders all eleven canonical tabs, Files after Medical, External links after Diligence, and Discussions last", async () => {
    // Act — the rendered strip, not the descriptor literal (Task 5's own
    // instruction): a parent_admin sees every tab, including the
    // parent_admin/self_manager-gated Medical tab.
    const { screen } = await renderShidduchShow("parent_admin");
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
      "Medical",
      "Files",
      "Diligence",
      "External links",
      "Notes",
      "Tasks",
      "Activity",
      "Discussions",
    ]);
  });
});

describe("shidduchimDescriptor — the real Discussions tab (Story 7.1, AC 9)", () => {
  it("shows the Discussions tab to every role, including a single with no visible suggestion (an empty tab is correct, not a leak)", async () => {
    // Act
    const { screen } = await renderShidduchShow("single");

    // Assert — no visibleTo restriction (contract §2 rule 7): present for
    // every role, unlike the five tabs Story 6.3 hid.
    await expect
      .element(screen.getByRole("tab", { name: "Discussions" }))
      .toBeInTheDocument();
  });

  it("lets a parent_admin start a discussion and read it back", async () => {
    // Act
    const { screen } = await renderShidduchShow("parent_admin");
    await screen.getByRole("tab", { name: "Discussions" }).click();
    await screen.getByRole("button", { name: "Start a discussion" }).click();

    // Assert — the panel mounts once a thread exists (no message yet).
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
  });
});

describe("shidduchimDescriptor — the real Tasks tab's visibleTo (Story 6.2, AC 10)", () => {
  it("shows the Tasks tab to a parent_admin viewer", async () => {
    // Act
    const { screen } = await renderShidduchShow("parent_admin");

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Tasks" }))
      .toBeInTheDocument();
  });

  it("never renders the Tasks tab (or its label anywhere) for a single viewer — RLS empties the table, this hides the dead shell", async () => {
    // Act
    const { screen } = await renderShidduchShow("single");

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

describe("shidduchimDescriptor — the real diligence/external-links/files/notes/activity tabs' visibleTo (Story 6.3, AC 9)", () => {
  it.each([
    ["Files", "parent_admin"],
    ["Diligence", "parent_admin"],
    ["External links", "parent_admin"],
    ["Notes", "parent_admin"],
    ["Activity", "parent_admin"],
  ] as const)("shows the %s tab to a %s viewer", async (tabName, role) => {
    // Act
    const { screen } = await renderShidduchShow(role);

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: tabName }))
      .toBeInTheDocument();
  });

  it.each([
    "Files",
    "Diligence",
    "External links",
    "Notes",
    "Activity",
  ] as const)(
    "never renders the %s tab (or its label anywhere) for a single viewer — RLS empties the underlying table(s), this hides the dead shell",
    async (tabName) => {
      // Act
      const { screen } = await renderShidduchShow("single");

      // Assert — the Overview anchor proves the tab strip has actually
      // mounted before the negative assertion runs.
      await expect
        .element(screen.getByRole("tab", { name: "Overview" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("tab", { name: tabName }))
        .not.toBeInTheDocument();
      expect(screen.container.textContent ?? "").not.toContain(tabName);
    },
  );

  it("a single viewer still sees the dignity-floor tabs (Overview, Resume, Photo)", async () => {
    // Act
    const { screen } = await renderShidduchShow("single");

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Resume" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Photo" }))
      .toBeInTheDocument();
  });
});

describe("shidduchimDescriptor — the real Files tab is scoped to this record (Story 5.6, AC 1)", () => {
  const buildFile = (
    overrides: Partial<EntityFile> & Pick<EntityFile, "id">,
  ): EntityFile => ({
    account_id: 1,
    target_type: "shidduch",
    target_id: 1,
    storage_path: "1/shidduch/1/file.pdf",
    file_name: "file.pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    visibility: "shared",
    uploaded_by_member_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this shidduch's own file, never a row filed under a different target_id or a different targetType sharing this numeric id", async () => {
    // Arrange — `ShidduchFilesTab` (entityDescriptorRegions.tsx) is supposed
    // to render `<FilesTab targetType="shidduch" targetId={record.id} />`.
    // Neither prop is checked by any existing test: mutating either one to a
    // wrong-but-still-valid value (e.g. `targetType="single"`) previously
    // left `make typecheck` and the whole suite green. Seeding one
    // wrong-target_id row and one wrong-targetType row alongside the correct
    // one makes both mutations fail this test.
    const { screen } = await renderShidduchShow(
      "parent_admin",
      (db, shidduchId) => {
        db.entity_files = [
          buildFile({
            id: 1,
            target_type: "shidduch",
            target_id: shidduchId,
            file_name: "This Shidduch File.pdf",
          }),
          buildFile({
            id: 2,
            target_type: "shidduch",
            target_id: 9999999,
            file_name: "Other Shidduch File.pdf",
          }),
          buildFile({
            id: 3,
            target_type: "single",
            target_id: shidduchId,
            file_name: "Same Id Wrong Type File.pdf",
          }),
        ];
      },
    );

    // Act
    await screen.getByRole("tab", { name: "Files" }).click();

    // Assert — the record's own file renders...
    await expect
      .element(screen.getByText("This Shidduch File.pdf"))
      .toBeInTheDocument();
    // ...and neither the wrong-target_id row nor the wrong-targetType row
    // (which shares this shidduch's numeric id) does.
    expect(screen.container.textContent ?? "").not.toContain(
      "Other Shidduch File.pdf",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type File.pdf",
    );
  });
});

describe("shidduchimDescriptor — the Overview tab mounts SingleInputForm (Story 6.4, AC 6)", () => {
  it("shows the single's input form on the Overview tab for a single viewer", async () => {
    // Act
    const { screen } = await renderShidduchShow("single");
    await screen.getByRole("tab", { name: "Overview" }).click();

    // Assert
    await expect
      .element(screen.getByText("Share your input"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder("What do you think of this suggestion?"))
      .toBeInTheDocument();
  });

  it("never mounts the form (or its heading anywhere) for a parent_admin viewer — the tab content itself gates on role, not only the rail", async () => {
    // Act
    const { screen } = await renderShidduchShow("parent_admin");
    await screen.getByRole("tab", { name: "Overview" }).click();

    // Assert — the Overview tab strip itself proves the tab actually
    // rendered before the negative assertion runs.
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "Share your input",
    );
  });
});

describe("shidduchimDescriptor — the right rail (Story 5.7, AC 1 / AC 2 / AC 3 / AC 4)", () => {
  /**
   * Dev Notes: `EntityShow` deliberately withholds `rightRail` while the
   * viewer role is pending (`EntityShow.tsx:116-137`) — `renderShidduchShow`
   * always seeds `MY_CONTEXTS_QUERY_KEY` synchronously, so every assertion
   * here is against the already-settled state, per that instruction.
   */
  it("renders all three rail panels beside the tab content, with the settled empty/disabled states, for a viewer with no rail data yet", async () => {
    // Act — richer demo data now seeds resumes for some shidduchim. To keep
    // this test focused on the empty/disabled rail state, clear the seeded
    // rail data for the viewed shidduch.
    const { screen } = await renderShidduchShow(
      "parent_admin",
      (db, shidduchId) => {
        db.resumes = db.resumes.filter((r) => r.shidduchim_id !== shidduchId);
        db.resume_photos = db.resume_photos.filter(
          (p) => !p.path.includes(`/${shidduchId}/`),
        );
      },
    );

    // Assert — the tab strip proves the settled (non-pending) render.
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    // The single's input panel, empty.
    await expect
      .element(screen.getByText("The single's input"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Nothing has been shared yet."))
      .toBeInTheDocument();
    // The reminders panel, empty, with a link to the Tasks tab.
    await expect.element(screen.getByText("Reminders")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "See all tasks" }))
      .toBeInTheDocument();
    // The forward action, disabled — no resume exists for this shidduch.
    await expect
      .element(screen.getByRole("button", { name: "Forward resume" }))
      .toBeDisabled();
  });

  it("the single input panel renders only this shidduch's own single_input rows, never a different shidduch's or a different kind", async () => {
    // Arrange — one row that belongs, one filed under a different
    // shidduch's target_id, one that belongs to this shidduch but under a
    // different kind. Mutating `SingleInputPanel`'s filter to drop any one
    // of the three fields previously left `make typecheck` and the rest of
    // the suite green.
    const { screen } = await renderShidduchShow(
      "parent_admin",
      (db, shidduchId) => {
        let nextId = 90000;
        const build = (overrides: Partial<Interaction>): Interaction => ({
          id: nextId++,
          account_id: 1,
          target_type: "shidduch",
          target_id: shidduchId,
          scope: "shidduch",
          kind: "single_input",
          created_at: "2026-01-01T00:00:00Z",
          ...overrides,
        });
        db.interactions = [
          ...db.interactions,
          build({ body: "This Shidduch's Own Share" }),
          build({ target_id: 9999999, body: "A Different Shidduch's Share" }),
          build({ kind: "note", body: "Same Shidduch Wrong Kind Note" }),
        ];
      },
    );

    // Assert
    await expect
      .element(screen.getByText("This Shidduch's Own Share"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Shidduch's Share",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Shidduch Wrong Kind Note",
    );
  });

  it("the reminders panel lists only this shidduch's own open tasks and links to THIS shidduch's Tasks tab (review finding F1)", async () => {
    // Arrange — one task that belongs to this shidduch, one filed under a
    // different shidduch's target_id. Mutating `ShidduchRightRail`'s
    // `targetType`/`targetId` props on `TasksRailSummary` previously left
    // `make typecheck` and the whole suite green: the only existing coverage
    // of the mounted rail asserted the "Reminders" heading and that a "See
    // all tasks" link exists, never that a task belonging to this shidduch
    // renders or that the link's href targets this shidduch (review finding
    // F1). `capturedShidduchId` lets the assertions below reference the
    // SAME id `renderShidduchShow` generated, rather than a hardcoded one.
    let capturedShidduchId: Identifier | undefined;
    const { screen } = await renderShidduchShow(
      "parent_admin",
      (db, shidduchId) => {
        capturedShidduchId = shidduchId;
        let nextId = 80000;
        const buildTask = (overrides: Partial<Task>): Task => ({
          id: nextId++,
          type: "reminder",
          text: "placeholder",
          due_date: "2026-02-01T00:00:00Z",
          done_date: null,
          target_type: "shidduch",
          target_id: shidduchId,
          ...overrides,
        });
        db.tasks = [
          ...db.tasks,
          buildTask({ text: "This Shidduch's Own Reminder" }),
          buildTask({
            target_id: 9999999,
            text: "A Different Shidduch's Reminder",
          }),
        ];
      },
    );

    // Assert — this shidduch's own open task renders...
    await expect
      .element(screen.getByText("This Shidduch's Own Reminder"))
      .toBeInTheDocument();
    // ...the foreign shidduch's task never does...
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Shidduch's Reminder",
    );
    // ...and the "See all tasks" link targets THIS shidduch's Tasks tab,
    // built through `buildTabPath` — a wrong `targetId` (e.g. a stray
    // literal) would still pass every other assertion here but produce a
    // broken href.
    const link = screen.getByRole("link", { name: "See all tasks" });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      buildTabPath("shidduchim", capturedShidduchId!, "tasks"),
    );
  });

  it("the forward button becomes enabled once a resume file exists for this shidduch", async () => {
    // Arrange
    const { screen } = await renderShidduchShow(
      "parent_admin",
      (db, shidduchId) => {
        db.resumes = [
          ...db.resumes,
          {
            id: 90000,
            account_id: 1,
            shidduchim_id: shidduchId,
            files: [
              {
                path: `1/resumes/${shidduchId}/rail-resume.pdf`,
                filename: "rail-resume.pdf",
                uploaded_at: "2026-01-01T00:00:00Z",
                uploaded_by: null,
                mime_type: "application/pdf",
                size: 1024,
              },
            ],
            created_at: "2026-01-01T00:00:00Z",
          } satisfies Resume,
        ];
      },
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Forward resume" }))
      .not.toBeDisabled();
  });
});

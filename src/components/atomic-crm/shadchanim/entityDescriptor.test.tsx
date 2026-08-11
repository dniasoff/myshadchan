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
  Shidduch,
  Task,
} from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { buildRecordPath } from "../entity360/entityPaths";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect imports — register the REAL shadchanimDescriptor AND the real
// shidduchimDescriptor, exactly like `shadchanim/index.ts` and
// `shidduchim/index.ts` both do at boot (a real app has both registered by
// the time a viewer opens a shadchan's Shidduchim tab). The second import
// keeps `RecordLink` from degrading to an inert `<span>`.
import "../shidduchim/entityDescriptor";
import "./entityDescriptor";

/**
 * Story 5.9, Task 5: adapter-wrapper and Overview-tab coverage.
 * `shidduchim/entityDescriptor.test.tsx` / `singles/entityDescriptor.test.tsx`'s
 * pattern applied to `shadchanim` — a real `EntityShow` render through
 * `buildEntityRoutes`, driven by the real FakeRest data provider, so a
 * mutated adapter prop (`targetType`, `shadchanId` vs `singleId`-shaped
 * mistakes, etc.) fails a real assertion instead of only `make typecheck`.
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

const renderShadchanShow = async (
  configureDb: (
    db: ReturnType<typeof generateData>,
    shadchanId: Identifier,
  ) => void = () => {},
  overrideDataProvider: (
    base: CrmDataProvider,
  ) => Partial<CrmDataProvider> = () => ({}),
  role: MemberRole = "parent_admin",
) => {
  const db = generateData();
  const shadchanId = db.shadchanim[0].id;
  configureDb(db, shadchanId);
  const baseDataProvider = createDataProvider({ db, latency: 0, silent: true });
  const dataProvider: CrmDataProvider = {
    ...baseDataProvider,
    ...overrideDataProvider(baseDataProvider),
  };
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
    <TestMemoryRouter initialEntries={[`/shadchanim/${shadchanId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/shadchanim/*"
            element={
              <ResourceContextProvider value="shadchanim">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, shadchanId, dataProvider };
};

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

describe("shadchanimDescriptor — tab strip order (Story 5.9, AC 3)", () => {
  it("renders all five canonical tabs, in canonical order, on the rendered strip (not merely the descriptor literal)", async () => {
    // Act
    const { screen } = await renderShadchanShow();
    await expect
      .element(screen.getByRole("tab", { name: "Overview", exact: true }))
      .toBeInTheDocument();

    // Assert
    const names = screen
      .getByRole("tab")
      .elements()
      .map((element) => element.textContent?.trim());
    expect(names).toEqual([
      "Overview",
      "Shidduchim",
      "Notes",
      "Tasks",
      "Activity",
    ]);
  });
});

describe("shadchanimDescriptor — the real Tasks tab's visibleTo (Story 6.2, AC 10)", () => {
  it("shows the Tasks tab to a parent_admin viewer", async () => {
    // Act
    const { screen } = await renderShadchanShow(
      undefined,
      undefined,
      "parent_admin",
    );

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Tasks", exact: true }))
      .toBeInTheDocument();
  });

  it("never renders the Tasks tab (or its label anywhere) for a single viewer — RLS empties the table, this hides the dead shell", async () => {
    // Act
    const { screen } = await renderShadchanShow(undefined, undefined, "single");

    // Assert — the Overview anchor proves the tab strip has actually
    // mounted before the negative assertion runs.
    await expect
      .element(screen.getByRole("tab", { name: "Overview", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Tasks", exact: true }))
      .not.toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain("Tasks");
  });
});

describe("shadchanimDescriptor — identity header and stat band adapters render the real record (Story 5.9)", () => {
  it("shows the shadchan's own name (ShadchanIdentityHeader) and the shidduchim stat tiles keyed on THIS shadchan's own id (ShadchanStatBand)", async () => {
    // Arrange — this shadchan's own name, from the seeded fixture, plus a
    // distinctive, non-zero "Progressed" count attributed ONLY to this
    // shadchan. `StatStrip` renders every tile unconditionally (`data?.x ??
    // 0`), so a mutated `shadchanId={9999999}` still renders a "Progressed"
    // label — it renders "0", not this fixture's exact value. Asserting the
    // label's presence alone (as an earlier version of this test did) cannot
    // tell the two apart; asserting the exact value can.
    const { screen, shadchanId } = await renderShadchanShow((db, id) => {
      const singleId = db.singles[0].id;
      db.shidduchim = [
        ...db.shidduchim.filter((s) => s.shadchan_id !== id),
        buildShidduch({
          id: 90610,
          single_id: singleId,
          shadchan_id: id,
          pipeline_state: "yes",
        }),
      ];
    });
    const shadchanName = "Mrs. Gold";

    // Assert — the identity header adapter rendered ShadchanHeader with
    // THIS record (a mutated `{ shadchan: record }` -> wrong prop would
    // crash or render nothing).
    await expect
      .element(screen.getByRole("heading", { name: shadchanName }))
      .toBeInTheDocument();

    // Assert — the stat band adapter rendered ShadchanStatsRow keyed on
    // THIS shadchan's id: exactly one shidduch, already at "yes", so
    // "Progressed" reads "1" (moved past "new") and nothing else could
    // produce that exact value by coincidence with a wrong/missing id (which
    // renders "0"). Scoped to the segment sharing this label, not a bare
    // `getByText("1")` — the identity header's own "In your book since" line
    // does not contain a bare "1", but scoping avoids relying on that.
    const progressedLabel = screen.getByText("Progressed", { exact: true });
    await expect.element(progressedLabel).toBeInTheDocument();
    const segment = progressedLabel.element().parentElement;
    expect(segment?.textContent).toBe("1Progressed");
    expect(shadchanId).toBeDefined();
  });
});

describe("shadchanimDescriptor — the Overview tab renders Last redt / Working on now from shadchan_stats (Story 5.9, RULING 8)", () => {
  it("renders Last redt and Working on now once shadchan_stats resolves", async () => {
    // Arrange — clear whatever the base fixture already attributed to this
    // shadchan, then attribute TWO shidduchim on two DIFFERENT singles: one
    // still open, one already at a terminal state. nb_suggestions (2) and
    // nb_open_singles (1) are deliberately different values here — a swap of
    // `stats.nb_open_singles` for `stats.nb_suggestions` in
    // `ShadchanOverviewTab.tsx` would render "2", not "1", and the exact-value
    // assertion below catches it (the earlier fixture used exactly one
    // shidduch, where both counts happen to coincide at 1 and a swap would
    // have gone undetected).
    const { screen } = await renderShadchanShow((db, shadchanId) => {
      const singleId = db.singles[0].id;
      const otherSingleId = db.singles[1].id;
      db.shidduchim = [
        ...db.shidduchim.filter((s) => s.shadchan_id !== shadchanId),
        buildShidduch({
          id: 90600,
          single_id: singleId,
          shadchan_id: shadchanId,
          pipeline_state: "look_into",
          redt_date: "2026-03-15",
        }),
        buildShidduch({
          id: 90601,
          single_id: otherSingleId,
          shadchan_id: shadchanId,
          pipeline_state: "yes",
          redt_date: "2026-01-01",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Overview", exact: true }).click();

    // Assert
    await expect.element(screen.getByText("Last redt")).toBeInTheDocument();
    const workingOnNowLabel = screen.getByText("Working on now");
    await expect.element(workingOnNowLabel).toBeInTheDocument();
    await expect.element(screen.getByText("15 Mar 2026")).toBeInTheDocument();
    // Scoped to this fact row's own container, exact value: 1 distinct open
    // single, never 2 (the total shidduchim count) and never fabricated. An
    // exact match (not `toContain`/`endsWith`) so a value like "21" cannot
    // also satisfy it.
    const factRow = workingOnNowLabel.element().closest("div");
    expect(factRow?.textContent).toBe("Working on now1");
  });

  it("renders the empty state (no Last redt / no Working on now count) for a shadchan with zero attributed shidduchim", async () => {
    // Arrange — an idle shadchan, no shidduchim attributed at all.
    const { screen } = await renderShadchanShow((db, shadchanId) => {
      db.shidduchim = db.shidduchim.filter((s) => s.shadchan_id !== shadchanId);
    });

    // Act
    await screen.getByRole("tab", { name: "Overview", exact: true }).click();

    // Assert — "Working on now" still renders (0 is a real fact, not
    // absence), but no redt date is ever fabricated.
    const workingOnNowLabel = screen.getByText("Working on now");
    await expect.element(workingOnNowLabel).toBeInTheDocument();
    // Scoped to this fact row's own container — the stat band above it
    // (ShadchanStatsRow) also renders zeroed tiles for an idle shadchan, so
    // a bare `getByText("0")` would match more than one element. An exact
    // match (not `toContain`) so a value like "10" cannot also satisfy it.
    const factRow = workingOnNowLabel.element().closest("div");
    expect(factRow?.textContent).toBe("Working on now0");
    expect(screen.container.textContent ?? "").not.toContain("Last redt");
  });

  it("shows a translated error message, never the empty-details copy, when shadchan_stats fails to load", async () => {
    // Arrange — `shadchan_stats` rejects (e.g. a 403), everything else
    // (including the shadchan record itself) still resolves normally.
    const { screen } = await renderShadchanShow(undefined, (base) => ({
      getOne: (async (
        resource: Parameters<CrmDataProvider["getOne"]>[0],
        params: Parameters<CrmDataProvider["getOne"]>[1],
      ) => {
        if (resource === "shadchan_stats") {
          throw new Error("shadchan_stats fetch failed");
        }
        return base.getOne(resource, params);
      }) as CrmDataProvider["getOne"],
    }));

    // Act
    await screen.getByRole("tab", { name: "Overview", exact: true }).click();

    // Assert — never silently swallowed as "no details on file yet."
    await expect
      .element(
        screen.getByText(
          "Could not load this shadchan's stats. Try refreshing the page.",
        ),
      )
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "No details on file yet.",
    );
  });
});

describe("shadchanimDescriptor — the real Notes tab is scoped to targetType='shadchan' (Story 5.9)", () => {
  const buildNote = (
    overrides: Partial<Interaction> & Pick<Interaction, "id">,
  ): Interaction => ({
    account_id: 1,
    target_type: "shadchan",
    target_id: 1,
    scope: "account",
    kind: "note",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("renders this shadchan's own note, never a note filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderShadchanShow((db, shadchanId) => {
      db.interactions = [
        ...db.interactions,
        buildNote({
          id: 90701,
          target_type: "shadchan",
          target_id: shadchanId,
          body: "This Shadchan's Own Note",
        }),
        buildNote({
          id: 90702,
          target_type: "shadchan",
          target_id: 9999999,
          body: "A Different Shadchan's Note",
        }),
        buildNote({
          id: 90703,
          target_type: "shidduch",
          target_id: shadchanId,
          scope: "shidduch",
          body: "Same Id Wrong Type Note",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Notes", exact: true }).click();

    // Assert
    await expect
      .element(screen.getByText("This Shadchan's Own Note"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Shadchan's Note",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Note",
    );
  });
});

describe("shadchanimDescriptor — the real Tasks tab is scoped to targetType='shadchan' (Story 5.9)", () => {
  const buildTask = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
    type: "reminder",
    text: "placeholder",
    due_date: "2026-02-01T00:00:00Z",
    done_date: null,
    target_type: "shadchan",
    target_id: 1,
    ...overrides,
  });

  it("renders this shadchan's own task, never a task filed under a different target_id or a different targetType sharing this numeric id", async () => {
    const { screen } = await renderShadchanShow((db, shadchanId) => {
      db.tasks = [
        ...db.tasks,
        buildTask({
          id: 90801,
          target_type: "shadchan",
          target_id: shadchanId,
          text: "This Shadchan's Own Task",
        }),
        buildTask({
          id: 90802,
          target_type: "shadchan",
          target_id: 9999999,
          text: "A Different Shadchan's Task",
        }),
        buildTask({
          id: 90803,
          target_type: "shidduch",
          target_id: shadchanId,
          text: "Same Id Wrong Type Task",
        }),
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Tasks", exact: true }).click();

    // Assert
    await expect
      .element(screen.getByText("This Shadchan's Own Task"))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "A Different Shadchan's Task",
    );
    expect(screen.container.textContent ?? "").not.toContain(
      "Same Id Wrong Type Task",
    );
  });
});

describe("shadchanimDescriptor — the Shidduchim tab renders ShadchanSuggestions, RecordLink-based (Story 5.9)", () => {
  it("renders a shidduch attributed to this shadchan, linking to its own AD-24 record route", async () => {
    const shidduchId = 90900;
    const { screen } = await renderShadchanShow((db, shadchanId) => {
      const singleId = db.singles[0].id;
      // Clear whatever the base fixture already attributed to this
      // shadchan — otherwise the 5-row preview (ShadchanSuggestions,
      // sorted by redt_date DESC) could push this fixture's row behind
      // the "Show all N" toggle before the assertion ever looks for it.
      db.shidduchim = [
        ...db.shidduchim.filter((s) => s.shadchan_id !== shadchanId),
        {
          id: shidduchId,
          account_id: 1,
          single_id: singleId,
          shadchan_id: shadchanId,
          name_en: "Distinctive Shidduch Name",
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
        } as Shidduch,
      ];
    });

    // Act
    await screen.getByRole("tab", { name: "Shidduchim", exact: true }).click();

    // Assert
    const link = screen.getByRole("link", {
      name: "Distinctive Shidduch Name",
    });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      buildRecordPath("shidduchim", shidduchId),
    );
  });
});

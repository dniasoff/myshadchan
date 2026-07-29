import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";
import type { NavigateFunction } from "react-router";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext } from "../types";
import { buildEntityRoutes } from "./buildEntityRoutes";
import type { EntityDescriptor } from "./entityDescriptor";
import { Entity360Tabs } from "./Entity360Tabs";
import { EntityShow } from "./EntityShow";
import type { MergedEntityTab } from "./mergeEntityTabs";
import { registerEntityDescriptor } from "./registry";
import { TAB_LABELS, type TabKey } from "./tabKeys";

/**
 * Story 3.4 AC 5, 6, 7. `buildEntityRoutes` + `EntityShow` is the same
 * harness `EntityShow.test.tsx` uses, extended with a `QueryClient` seeded
 * on `MY_CONTEXTS_QUERY_KEY` (`layout/ContextSwitcher.test.tsx`'s pattern)
 * so the viewer's role is fully under this file's control.
 *
 * `buildRecordPath` returns a bare `/${id}` (no resource-name segment) so
 * `buildEntityRoutes`, mounted directly at the `TestMemoryRouter` root
 * (exactly as `EntityShow.test.tsx` mounts it), produces pathnames that
 * line up byte-for-byte with what `Entity360TabStrip`'s own
 * `buildTabPath`-based links and redirects target — the pathname
 * observables AC 6 pins (`/1/overview`, `/1/medical`, …) are then real
 * router state, not incidental strings.
 */

const FIXTURE_RESOURCE = "entity-show-permissions-fixture";
const FIXTURE_RECORD = { id: 1 };

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const registerFixtureDescriptor = (
  overrides: Partial<EntityDescriptor> = {},
): void => {
  registerEntityDescriptor(
    {
      name: FIXTURE_RESOURCE,
      label: "Fixture",
      buildRecordPath: (id) => `/${id}`,
      ...overrides,
    },
    { replace: true },
  );
};

const renderEntityShow = async (
  initialEntries: string[],
  options: {
    role?: MemberRole;
    getMyContexts?: () => Promise<MyContext[]>;
    initialIndex?: number;
    navigateCallback?: (navigate: NavigateFunction) => void;
  } = {},
) => {
  const contexts = options.role ? [contextFor(options.role)] : [];
  const queryClient = new QueryClient();
  if (!options.getMyContexts) {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  }
  const dataProvider = {
    getOne: vi.fn().mockResolvedValue({ data: FIXTURE_RECORD }),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getMyContexts: vi.fn(
      options.getMyContexts ?? (() => Promise.resolve(contexts)),
    ),
  } as unknown as DataProvider;

  const locations: string[] = [];
  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      initialIndex={options.initialIndex}
      locationCallback={(location) => {
        locations.push(location.pathname);
      }}
      navigateCallback={options.navigateCallback}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          {buildEntityRoutes({ List: () => null, Show: EntityShow })}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return {
    screen,
    locations,
    getPathname: () => locations[locations.length - 1],
  };
};

const tabNames = (screen: { container: HTMLElement }): string[] =>
  Array.from(screen.container.querySelectorAll('[role="tab"]')).map(
    (el) => el.textContent ?? "",
  );

describe("EntityShow — a denied tab is absent from the DOM and its render is never called (AC 5)", () => {
  it("a viewer without the allowed role never sees the restricted tab or triggers its render", async () => {
    // Arrange
    const overviewRender = vi.fn(() => <div>OVERVIEW_CONTENT</div>);
    const medicalRender = vi.fn(() => <div>MEDICAL_CONTENT</div>);
    registerFixtureDescriptor({
      title: () => "Permissions Fixture",
      tabs: [
        { key: "overview", render: overviewRender },
        {
          key: "medical",
          visibleTo: ["parent_admin"],
          render: medicalRender,
        },
      ],
    });

    // Act
    const { screen } = await renderEntityShow(["/1"], { role: "helper" });

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .not.toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain("Medical");
    expect(screen.container.textContent ?? "").not.toContain("MEDICAL_CONTENT");
    expect(medicalRender).not.toHaveBeenCalled();
    expect(overviewRender).toHaveBeenCalled();
  });

  it("the same fixture with an allowed viewer shows the tab and fires its render once selected", async () => {
    // Arrange
    const medicalRender = vi.fn(() => <div>MEDICAL_CONTENT</div>);
    registerFixtureDescriptor({
      title: () => "Permissions Fixture",
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
        {
          key: "medical",
          visibleTo: ["parent_admin"],
          render: medicalRender,
        },
      ],
    });

    // Act — deep-linked directly onto the restricted tab.
    const { screen } = await renderEntityShow(["/1/medical"], {
      role: "parent_admin",
    });

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("MEDICAL_CONTENT"))
      .toBeInTheDocument();
    expect(medicalRender).toHaveBeenCalled();
  });

  it("Entity360Tabs itself does no permission work — a tab handed to it directly renders regardless of the viewer's role", async () => {
    // Arrange — `tabs` is typed as `MergedEntityTab[]`, the shape
    // `EntityShow` actually hands off post-merge (`visibleTo` present at
    // runtime), assigned to a variable rather than an inline object literal
    // so excess-property checking does not silently mask `visibleTo` from
    // reaching `Entity360Tabs` at the type level; `MergedEntityTab[]` is
    // still structurally assignable to `Entity360TabsProps["tabs"]`. The
    // viewer role is `helper` — real, resolved, and excluded by
    // `visibleTo: ["parent_admin"]` — so if `Entity360TabStrip` or
    // `Entity360TabPanel` ever grew a second, duplicate `hasVisibility`
    // check of their own, this fixture would make it observable: the tab
    // would disappear here even though nothing outside `EntityShow` is
    // supposed to filter. A fixture with no `visibleTo` at all cannot prove
    // this — it passes identically whether or not a duplicate check exists.
    const medicalRender = vi.fn(() => <div>MEDICAL_CONTENT</div>);
    const tabs: MergedEntityTab[] = [
      { key: "medical", visibleTo: ["parent_admin"], render: medicalRender },
    ];
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [contextFor("helper")]);
    const dataProvider = {
      getMyContexts: vi.fn().mockResolvedValue([contextFor("helper")]),
    } as unknown as DataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter initialEntries={["/1"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value={FIXTURE_RESOURCE}>
            <RecordContextProvider value={FIXTURE_RECORD}>
              <Entity360Tabs tabs={tabs} />
            </RecordContextProvider>
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — renders (and its content fires) despite the seeded `helper`
    // viewer being excluded by `visibleTo`.
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("MEDICAL_CONTENT"))
      .toBeInTheDocument();
    expect(medicalRender).toHaveBeenCalled();
  });

  it("a denied explicit tab does not leave a same-keyed relationship's tab to render in its place", async () => {
    // Arrange — `shidduchim` is declared BOTH as an explicit, restricted
    // tab AND as a relationship. `mergeEntityTabs` lets the explicit entry
    // win the key's slot regardless of visibility (contract §9); filtering
    // the MERGED array (not `descriptor.tabs` before the merge) is what
    // keeps a denied explicit tab from exposing the unrestricted
    // relationship-derived fallback for the same key.
    const explicitRender = vi.fn(() => <div>EXPLICIT_SHIDDUCHIM_CONTENT</div>);
    const buildFixture = () =>
      registerFixtureDescriptor({
        title: () => "Shared-key Fixture",
        tabs: [
          { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
          {
            key: "shidduchim",
            visibleTo: ["parent_admin"],
            render: explicitRender,
          },
        ],
        relationships: [
          {
            key: "shidduchim",
            resource: FIXTURE_RESOURCE,
            getFilter: (record) => ({ parent_id: record.id }),
          },
        ],
      });

    // Act — a viewer without the allowed role.
    buildFixture();
    const denied = await renderEntityShow(["/1"], { role: "helper" });

    // Assert — the Shidduchim tab is absent entirely: no explicit content,
    // and no relationship-derived fallback rendered in its place (a leak
    // would add a second, unfiltered "Shidduchim" tab rendering
    // `RelatedRecordsTab`). Container-scoped (`tabNames`), never a
    // page-wide `getByText`/`getByRole` — this test mounts a second render
    // later, and `OVERVIEW_CONTENT`'s panel text itself substring-matches a
    // case-insensitive "Overview" query.
    await expect.poll(() => tabNames(denied.screen)).toEqual(["Overview"]);
    expect(denied.screen.container.textContent ?? "").not.toContain(
      "Shidduchim",
    );
    expect(denied.screen.container.textContent ?? "").not.toContain(
      "EXPLICIT_SHIDDUCHIM_CONTENT",
    );
    expect(explicitRender).not.toHaveBeenCalled();

    // Act — a viewer WITH the allowed role sees the explicit content, still
    // never the relationship's.
    buildFixture();
    const allowed = await renderEntityShow(["/1/shidduchim"], {
      role: "parent_admin",
    });

    // Assert
    await expect
      .element(allowed.screen.getByText("EXPLICIT_SHIDDUCHIM_CONTENT"))
      .toBeInTheDocument();
    expect(explicitRender).toHaveBeenCalled();
  });
});

describe("EntityShow — a pending role never navigates (AC 6a)", () => {
  it("holds a deep-linked restricted tab in place while the role resolves, then renders it once permitted", async () => {
    // Arrange
    registerFixtureDescriptor({
      title: () => "Pending Fixture",
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
        {
          key: "medical",
          visibleTo: ["parent_admin"],
          render: () => <div>MEDICAL_CONTENT</div>,
        },
      ],
    });
    let resolveContexts: (contexts: MyContext[]) => void = () => {};
    const contextsPromise = new Promise<MyContext[]>((resolve) => {
      resolveContexts = resolve;
    });

    // Act — deep-link directly to the restricted tab while the role query
    // never settles.
    const { screen, locations } = await renderEntityShow(["/1/medical"], {
      getMyContexts: () => contextsPromise,
    });

    // Assert — pending: identity header renders, no tablist, URL unchanged,
    // exactly one recorded location (the initial mount), and the pending
    // region itself renders through the i18n provider (AC 6a) — not merely
    // an empty status placeholder. This is the same assertion shape as the
    // in-repo precedent for the sibling record-pending state
    // (`buildEntityRoutes.test.tsx`'s `RecordPending` coverage).
    await expect
      .element(screen.getByText("Pending Fixture"))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("tablist")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("status")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Loading your access…"))
      .toBeInTheDocument();
    expect(locations).toEqual(["/1/medical"]);

    // Act — settle the query, permitting the viewer.
    resolveContexts([contextFor("parent_admin")]);

    // Assert — the Medical tab now renders, the pending region is gone, and
    // no navigation ever happened.
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
    expect(locations).toEqual(["/1/medical"]);
  });
});

describe("EntityShow — denied is indistinguishable from unknown (AC 6b)", () => {
  it("a denied tab and an unknown tab settle on the same pathname, the same visible tab set, and no denial wording", async () => {
    // Arrange
    const buildFixture = () =>
      registerFixtureDescriptor({
        // Deliberately NOT named with any of the words the assertion below
        // scans for ("denied", "permission", …) — the fixture's own title
        // must not accidentally satisfy (or defeat) that check.
        title: () => "Restricted-tab Fixture",
        tabs: [
          { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
          {
            key: "medical",
            visibleTo: ["parent_admin"],
            render: () => <div>MEDICAL_CONTENT</div>,
          },
        ],
      });

    // Act
    buildFixture();
    const denied = await renderEntityShow(["/1/medical"], { role: "helper" });
    buildFixture();
    const unknown = await renderEntityShow(["/1/no-such-tab"], {
      role: "helper",
    });

    // Assert — both settle on the entity's first visible tab. Both fixtures
    // stay mounted on the same page for this whole test (neither is
    // unmounted), so the comparison below reads each render's OWN
    // container directly rather than a page-wide `getByRole` — a global
    // query would otherwise resolve to two "Overview" tabs at once, one per
    // render, and throw a strict-mode violation.
    await expect.poll(denied.getPathname).toBe("/1/overview");
    await expect.poll(unknown.getPathname).toBe("/1/overview");
    await expect.poll(() => tabNames(denied.screen)).toEqual(["Overview"]);
    await expect.poll(() => tabNames(unknown.screen)).toEqual(["Overview"]);

    // Assert — the same accessible tab set in both.
    expect(tabNames(denied.screen)).toEqual(tabNames(unknown.screen));

    // Assert — no second "access denied" branch anywhere in either render.
    expect(denied.screen.container.textContent ?? "").not.toMatch(
      /denied|permission|forbidden|not allowed/i,
    );
    expect(unknown.screen.container.textContent ?? "").not.toMatch(
      /denied|permission|forbidden|not allowed/i,
    );
  });
});

describe("EntityShow — the fallback replaces, it does not push (AC 6c)", () => {
  it("the replaced history entry never existed — back from the fallback skips it", async () => {
    // Arrange
    registerFixtureDescriptor({
      title: () => "Fallback Fixture",
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
        {
          key: "medical",
          visibleTo: ["parent_admin"],
          render: () => <div>MEDICAL_CONTENT</div>,
        },
      ],
    });
    let navigate: NavigateFunction | undefined;

    // Act — an entry BEFORE the denied deep link, so "back" lands outside
    // the fixture route entirely if (and only if) the fallback replaced.
    const { getPathname } = await renderEntityShow(["/", "/1/medical"], {
      role: "helper",
      initialIndex: 1,
      navigateCallback: (nav) => {
        navigate = nav;
      },
    });

    // Assert — settles on the first visible tab.
    await expect.poll(getPathname).toBe("/1/overview");

    // Act — one step back.
    navigate?.(-1);

    // Assert — with `push` this would land back on `/1/medical` and loop;
    // the replaced entry never existed, so back lands on "/".
    await expect.poll(getPathname).toBe("/");
  });
});

describe("EntityShow — the five-role negative sweep (AC 7, .claude/rules/security-triggers.md)", () => {
  // AC 1(a)'s exhaustiveness pattern, declared locally: a sixth `MemberRole`
  // fails this table to typecheck until it (and the map below) are updated.
  const ALL_MEMBER_ROLES_RECORD: Record<MemberRole, true> = {
    parent_admin: true,
    helper: true,
    self_manager: true,
    shadchan: true,
    single: true,
  };
  const ALL_MEMBER_ROLES = Object.keys(ALL_MEMBER_ROLES_RECORD) as MemberRole[];

  const ROLE_TAB_KEYS: Record<MemberRole, TabKey> = {
    parent_admin: "medical",
    helper: "notes",
    self_manager: "tasks",
    shadchan: "files",
    single: "photo",
  };

  const registerSweepFixture = (): Record<MemberRole, () => ReactNode> => {
    const renders: Record<MemberRole, () => ReactNode> = {
      parent_admin: vi.fn(() => <div>PARENT_ADMIN_CONTENT</div>),
      helper: vi.fn(() => <div>HELPER_CONTENT</div>),
      self_manager: vi.fn(() => <div>SELF_MANAGER_CONTENT</div>),
      shadchan: vi.fn(() => <div>SHADCHAN_CONTENT</div>),
      single: vi.fn(() => <div>SINGLE_CONTENT</div>),
    };

    registerFixtureDescriptor({
      title: () => "Sweep Fixture",
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_CONTENT</div> },
        ...ALL_MEMBER_ROLES.map((role) => ({
          key: ROLE_TAB_KEYS[role],
          visibleTo: [role],
          render: renders[role],
        })),
      ],
    });
    return renders;
  };

  it.each(ALL_MEMBER_ROLES)(
    "viewer %s sees exactly Overview and their own restricted tab",
    async (viewerRole) => {
      // Arrange
      const renders = registerSweepFixture();

      // Act
      const { screen } = await renderEntityShow(["/1"], {
        role: viewerRole,
      });

      // Assert
      await expect
        .element(screen.getByRole("tab", { name: "Overview" }))
        .toBeInTheDocument();
      await expect
        .element(
          screen.getByRole("tab", {
            name: TAB_LABELS[ROLE_TAB_KEYS[viewerRole]],
          }),
        )
        .toBeInTheDocument();
      expect(tabNames(screen)).toHaveLength(2);

      for (const otherRole of ALL_MEMBER_ROLES) {
        if (otherRole === viewerRole) {
          continue;
        }
        expect(screen.container.textContent ?? "").not.toContain(
          TAB_LABELS[ROLE_TAB_KEYS[otherRole]],
        );
        expect(renders[otherRole]).not.toHaveBeenCalled();
      }
    },
  );

  it("a settled role with no active context sees only Overview, with no navigation beyond the normal :id resolution", async () => {
    // Arrange — isPending: false, role: undefined (my_contexts() resolved,
    // but no row is is_active) — distinct from the AC 6a pending case.
    const renders = registerSweepFixture();

    // Act
    const { screen, getPathname } = await renderEntityShow(["/1"], {});

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    expect(tabNames(screen)).toHaveLength(1);
    for (const role of ALL_MEMBER_ROLES) {
      expect(renders[role]).not.toHaveBeenCalled();
    }
    expect(getPathname()).toBe("/1");
  });
});

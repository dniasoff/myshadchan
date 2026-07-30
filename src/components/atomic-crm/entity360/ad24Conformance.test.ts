import type { ComponentType } from "react";

import {
  CUSTOM_ROUTES,
  RECORD_FLAG_EXEMPTIONS,
  RESOURCES,
  findManifestViolations,
  type ResourceEntry,
} from "../root/routeManifest";
import type { EntityDescriptor, EntityTabDescriptor } from "./entityDescriptor";
// Side-effect imports — register the four Epic 3 stub descriptors, mirroring
// the real boot sequence, so the "real registry" test below has something
// to read (routeManifest.test.ts:25-39 is the precedent this test is
// modelled on).
import "../shidduchim/entityDescriptor";
import "../singles/entityDescriptor";
import "../shadchanim/entityDescriptor";
import "../references/entityDescriptor";
import { getEntityDescriptor } from "./registry";
import type { TabKey } from "./tabKeys";
import {
  CANONICAL_TAB_SETS,
  findAd24Violations,
  findBrowseShapedIndexes,
  findBrowseSurfaceEnumeration,
  findListPathLinks,
  findPendingTabs,
  isBrowseSurfaceModule,
  MODAL_RECORD_SURFACES,
  NO_BROWSE_SURFACE_ENTITIES,
  type Ad24Exemptions,
  type Ad24Violation,
  type Ad24ViolationCode,
} from "./ad24Conformance";

/**
 * `findAd24Violations` is pure and parameter-driven (AC 1): every fixture
 * below drives it with deliberately-broken inputs, never the real
 * `RESOURCES` / registry / exemption tables, mirroring
 * `root/routeManifest.test.ts`'s `NO_EXEMPTIONS` idiom. `EMPTY_EXEMPTIONS`
 * and `NO_BROWSE_NONE` keep each fixture isolated to the ONE rule it means
 * to exercise — without them, the real module-scope tables (populated with
 * today's genuine, unrelated entries) would leak extra violations into
 * every test.
 */

const dummy: ComponentType = () => null;

const EMPTY_EXEMPTIONS: Ad24Exemptions = {
  descriptorlessResources: {},
  recordSurfaceExemptions: {},
  modalRecordSurfaces: {},
  pendingRouteShapes: {},
};

const NO_BROWSE_NONE: Record<string, string> = {};

/** Exempts "references" from AC 2 (missing-descriptor) only — used by AC 10
 * fixtures, which register "references" as a plain resource (no descriptor)
 * purely so it can be named in `resources`/`noBrowseSurfaceEntities`; AC 2
 * is not what those fixtures mean to exercise. */
const REFERENCES_EXEMPT_FROM_AC2: Ad24Exemptions = {
  ...EMPTY_EXEMPTIONS,
  descriptorlessResources: {
    references: { kind: "permanent", reason: "test fixture" },
  },
};

/** A resource entry with a `list` by default, so AC 10(c) never fires as an
 * unintended side effect of a fixture that is testing something else. */
const resourceEntry = (
  name: string,
  definition: ResourceEntry["definition"] = { list: dummy },
): ResourceEntry => ({ name, surface: "both", definition });

const tab = (key: TabKey): EntityTabDescriptor => ({ key, render: () => null });

/** A minimal, otherwise-valid descriptor fixture. Callers override only the
 * fields their test cares about. */
const descriptorFixture = (
  overrides: Partial<EntityDescriptor> & { name: string },
): EntityDescriptor => ({
  label: overrides.name,
  buildRecordPath: (id) => `/${overrides.name}/${id}`,
  tabs: [],
  ...overrides,
});

const descriptorMap = (
  ...descriptors: EntityDescriptor[]
): Map<string, EntityDescriptor> =>
  new Map(descriptors.map((d) => [d.name, d]));

/** A descriptor for one of the four REAL entity names, shaped exactly like
 * its Story 3.9 stub (`tabs: []`, `pendingTabs`: the full canonical row) so
 * AC 6 stays silent — used by tests exercising a different rule (AC 5a,
 * AC 10) that would otherwise pick up an unrelated tab-set-incomplete
 * finding from a synthetic entity name with no CANONICAL_TAB_SETS row. */
const canonicallyCompleteDescriptor = (
  overrides: Partial<EntityDescriptor> & {
    name: keyof typeof CANONICAL_TAB_SETS;
  },
): EntityDescriptor =>
  descriptorFixture({
    tabs: [],
    pendingTabs: [...(CANONICAL_TAB_SETS[overrides.name] ?? [])],
    ...overrides,
  });

/** Full default input, every field empty/clean; a test overrides only the
 * field(s) relevant to the rule it exercises. */
const baseInput = (
  overrides: Partial<Parameters<typeof findAd24Violations>[0]> = {},
): Parameters<typeof findAd24Violations>[0] => ({
  resources: [],
  descriptors: new Map(),
  modalRecordSurfaces: [],
  handBuiltRecordPaths: [],
  navTargets: [],
  listPathLinks: [],
  browseSurfaceEnumerations: [],
  browseShapedIndexes: [],
  exemptions: EMPTY_EXEMPTIONS,
  noBrowseSurfaceEntities: NO_BROWSE_NONE,
  ...overrides,
});

const codesOf = (violations: Ad24Violation[]): Ad24ViolationCode[] =>
  violations.map((v) => v.code);

// The 5-1 shidduch tab set (5-1-shidduch-360-as-a-page.md AC 2): five real
// tabs, the remaining five canonical keys declared as pending. Reused by
// several tests below as "the shape that must never be flagged".
const FIVE_ONE_SHIDDUCH_TABS: TabKey[] = [
  "overview",
  "diligence",
  "notes",
  "tasks",
  "activity",
];
const FIVE_ONE_SHIDDUCH_PENDING: TabKey[] = [
  "resume",
  "photo",
  "medical",
  "files",
  "external-links",
];

describe("findAd24Violations — one it per Ad24ViolationCode (AC 1)", () => {
  it("reports missing-descriptor for a resource with no descriptor and no exemption", () => {
    // Arrange
    const input = baseInput({ resources: [resourceEntry("widgets")] });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "missing-descriptor",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports bespoke-record-surface for a resource declaring show with no RECORD_SURFACE_EXEMPTIONS entry", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("widgets", { list: dummy, show: dummy })],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "bespoke-record-surface",
        subject: "widgets:show",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports modal-record-surface for a scanned file with no MODAL_RECORD_SURFACES entry", () => {
    // Arrange
    const input = baseInput({
      modalRecordSurfaces: ["widgets/WidgetShow.tsx"],
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "modal-record-surface",
        subject: "widgets/WidgetShow.tsx",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports non-ad24-record-path for a descriptor whose buildRecordPath is not /{entity}/{id}", () => {
    // Arrange
    const input = baseInput({
      descriptors: descriptorMap(
        canonicallyCompleteDescriptor({
          name: "singles",
          buildRecordPath: (id) => `/singles/${id}/show`,
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "non-ad24-record-path",
        subject: "singles",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports hand-built-record-path for a scanned template-literal site outside the allowlist", () => {
    // Arrange
    const input = baseInput({
      handBuiltRecordPaths: ["shidduchim/SomeBespokeLink.tsx"],
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "hand-built-record-path",
        subject: "shidduchim/SomeBespokeLink.tsx",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports tab-key-unknown for a descriptor key outside TAB_KEYS (AC 6a)", () => {
    // Arrange — the canonical five shadchanim tabs plus an invented key. The
    // cast is what a real drifting descriptor would need to write, since
    // TabKey is a closed union.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shadchanim",
          tabs: [
            tab("overview"),
            tab("shidduchim"),
            tab("notes"),
            tab("tasks"),
            tab("activity"),
            { key: "summary" as TabKey, render: () => null },
          ],
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "tab-key-unknown",
        subject: "shadchanim",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports tab-key-duplicated when a key is declared as both present and pending (AC 6b)", () => {
    // Arrange
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shadchanim",
          tabs: [tab("overview"), tab("notes")],
          pendingTabs: ["shidduchim", "notes", "tasks", "activity"],
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "tab-key-duplicated",
        subject: "shadchanim",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports tab-order-drift when a tab's relative order inverts the canonical row (AC 6c)", () => {
    // Arrange — notes before diligence inverts the canonical row while the
    // union of tabs+pendingTabs stays complete.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shidduchim",
          tabs: [
            tab("overview"),
            tab("notes"),
            tab("diligence"),
            tab("tasks"),
            tab("activity"),
          ],
          pendingTabs: [
            "resume",
            "photo",
            "medical",
            "files",
            "external-links",
          ],
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "tab-order-drift",
        subject: "shidduchim",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports tab-set-incomplete when a canonical tab is in neither tabs nor pendingTabs (AC 6d)", () => {
    // Arrange — 5-1's five real tabs, but "medical" is dropped from
    // pendingTabs entirely.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shidduchim",
          tabs: FIVE_ONE_SHIDDUCH_TABS.map(tab),
          pendingTabs: ["resume", "photo", "files", "external-links"],
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "tab-set-incomplete",
        subject: "shidduchim",
        detail: expect.stringContaining("medical"),
      },
    ]);
  });

  it("reports stale-exemption for a table entry whose resource no longer exists", () => {
    // Arrange
    const input = baseInput({
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          ghost: { kind: "pending", retiredBy: "9.9" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "stale-exemption",
        subject: "ghost",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports permanent-exemption-for-360-entity when a permanent entry's resource now has a descriptor", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("widgets")],
      descriptors: descriptorMap(descriptorFixture({ name: "widgets" })),
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert — "widgets" has no row in CANONICAL_TAB_SETS, so it also
    // legitimately reports tab-set-incomplete (AC 8's anti-vacuity rule);
    // that is a different, correctly-firing code, not noise from this rule.
    expect(
      violations.filter((v) => v.code === "permanent-exemption-for-360-entity"),
    ).toEqual([
      {
        code: "permanent-exemption-for-360-entity",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports browse-surface-on-scoped-entity for a nav target resolving to a no-browse entity", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      navTargets: ["/", "/references"],
      noBrowseSurfaceEntities: { references: "test fixture" },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "browse-surface-on-scoped-entity",
        subject: "references",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports unlisted-entity-missing-index for a non-exempt resource with no list", () => {
    // Arrange — no show/create/edit either, so this fixture breaks exactly
    // AC 10(c) and not AC 3; exempted from AC 2 so only one code fires.
    const input = baseInput({
      resources: [resourceEntry("widgets", {})],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "unlisted-entity-missing-index",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });
});

describe("findAd24Violations — exemption staleness, both directions (AC 2-5)", () => {
  it("AC 2 — does not fire when a permanent entry's resource still has no descriptor", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("widgets")],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
      },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([]);
  });

  it("AC 2 — reports stale-exemption (not permanent-exemption-for-360-entity) when a PENDING entry's resource now has a descriptor", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("widgets")],
      descriptors: descriptorMap(descriptorFixture({ name: "widgets" })),
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "pending", retiredBy: "9.9" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations.filter((v) => v.subject === "widgets")).toContainEqual({
      code: "stale-exemption",
      subject: "widgets",
      detail: expect.any(String),
    });
    expect(codesOf(violations)).not.toContain(
      "permanent-exemption-for-360-entity",
    );
  });

  it("AC 3 — reports bespoke-record-surface only for the undeclared slot, not an exempted one", () => {
    // Arrange
    const input = baseInput({
      resources: [
        resourceEntry("widgets", { list: dummy, show: dummy, edit: dummy }),
      ],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
        recordSurfaceExemptions: {
          "widgets:show": { kind: "pending", retiredBy: "9.9" },
        },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "bespoke-record-surface",
        subject: "widgets:edit",
        detail: expect.any(String),
      },
    ]);
  });

  it("AC 3 — reports stale-exemption when the exempted slot is no longer declared", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("widgets")],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
        recordSurfaceExemptions: {
          "widgets:show": { kind: "pending", retiredBy: "9.9" },
        },
      },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "stale-exemption",
        subject: "widgets:show",
        detail: expect.any(String),
      },
    ]);
  });

  it("AC 4 — reports stale-exemption when a modal-surface entry is no longer found by the scan", () => {
    // Arrange
    const input = baseInput({
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        modalRecordSurfaces: {
          "widgets/WidgetShow.tsx": { kind: "pending", retiredBy: "9.9" },
        },
      },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "stale-exemption",
        subject: "widgets/WidgetShow.tsx",
        detail: expect.any(String),
      },
    ]);
  });

  it("AC 5a — does not fire once buildRecordPath is already AD-24 shaped", () => {
    // Arrange
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "widgets",
          buildRecordPath: (id) => `/widgets/${id}`,
        }),
      ),
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        pendingRouteShapes: { widgets: { kind: "pending", retiredBy: "9.9" } },
      },
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert — "widgets" carries no row in CANONICAL_TAB_SETS (AC 8), and
    // PENDING_ROUTE_SHAPES now names an entity whose path is already
    // AD-24-shaped, so the pending entry is stale.
    expect(
      violations.filter(
        (v) => v.subject === "widgets" && v.code === "stale-exemption",
      ),
    ).toEqual([
      {
        code: "stale-exemption",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });

  it("AC 5a — reports stale-exemption when the descriptor no longer exists at all", () => {
    // Arrange
    const input = baseInput({
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        pendingRouteShapes: { ghost: { kind: "pending", retiredBy: "9.9" } },
      },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "stale-exemption",
        subject: "ghost",
        detail: expect.any(String),
      },
    ]);
  });

  it("AC 5b — does not fire for the two allowed path-builder shapes or for test/guard files", () => {
    // Arrange
    const input = baseInput({
      handBuiltRecordPaths: [
        "entity360/entityPaths.ts",
        "singles/entityDescriptor.ts",
        "shidduchim/ShidduchCatchSection.test.tsx",
        "entity360/ad24Conformance.guard.test.ts",
      ],
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([]);
  });

  it("AC 10d — reports stale-exemption when NO_BROWSE_SURFACE_ENTITIES names a resource that no longer exists", () => {
    // Arrange
    const input = baseInput({
      noBrowseSurfaceEntities: { ghost: "test fixture" },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "stale-exemption",
        subject: "ghost",
        detail: expect.any(String),
      },
    ]);
  });
});

describe("findAd24Violations — AC 6 tab-set shape notes", () => {
  it("reports tab-set-incomplete (unexpected direction) when a key outside the entity's row is present", () => {
    // Arrange — shadchanim's canonical five plus "medical", a key that IS in
    // the union of all canonical rows but not in shadchanim's own row.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shadchanim",
          tabs: [
            tab("overview"),
            tab("shidduchim"),
            tab("notes"),
            tab("tasks"),
            tab("activity"),
            tab("medical"),
          ],
        }),
      ),
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "tab-set-incomplete",
        subject: "shadchanim",
        detail: expect.stringContaining("medical"),
      },
    ]);
  });

  it("reports tab-set-incomplete for a descriptor whose name has no CANONICAL_TAB_SETS row (AC 8 anti-vacuity)", () => {
    // Arrange — registering "connections" (Epic 8) before its row exists
    // must not buy a silent pass.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({ name: "connections", tabs: [tab("overview")] }),
      ),
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "tab-set-incomplete",
        subject: "connections",
        detail: expect.any(String),
      },
    ]);
  });

  it("reports no violation for 5-1's real five-tab shidduch descriptor (completeness is declared, not inferred)", () => {
    // Arrange — the exact shape 5-1-shidduch-360-as-a-page.md AC 2 ships:
    // five real tabs, the other five declared pending. Proves this story did
    // not quietly re-acquire the "every entity has every tab" rule RULING
    // removed.
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shidduchim",
          tabs: FIVE_ONE_SHIDDUCH_TABS.map(tab),
          pendingTabs: FIVE_ONE_SHIDDUCH_PENDING,
        }),
      ),
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([]);
  });
});

describe("findAd24Violations — AC 6 dedupe (F6, Story 3-11 review)", () => {
  it("reports tab-key-unknown once, not twice, when the same unknown key appears in both tabs and pendingTabs", () => {
    // Arrange — "summary" is invented and declared in BOTH arrays; AC 6's
    // own discipline ("each key is reported at most once") applies to (a)
    // exactly as it does to (b)-(d).
    const input = baseInput({
      descriptors: descriptorMap(
        descriptorFixture({
          name: "shadchanim",
          tabs: [
            tab("overview"),
            tab("shidduchim"),
            tab("notes"),
            tab("tasks"),
            tab("activity"),
            { key: "summary" as TabKey, render: () => null },
          ],
          pendingTabs: ["summary" as TabKey],
        }),
      ),
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert — exactly ONE tab-key-unknown, not one per array.
    expect(violations.filter((v) => v.code === "tab-key-unknown")).toEqual([
      {
        code: "tab-key-unknown",
        subject: "shadchanim",
        detail: expect.any(String),
      },
    ]);
  });
});

describe("findPendingTabs — AC 9", () => {
  it("returns only the descriptors with a non-empty pendingTabs", () => {
    // Arrange
    const withPending = descriptorFixture({
      name: "shidduchim",
      pendingTabs: ["resume", "photo"],
    });
    const withoutPending = descriptorFixture({ name: "singles" });
    const descriptors = descriptorMap(withPending, withoutPending);

    // Act
    const ledger = findPendingTabs(descriptors);

    // Assert
    expect(ledger).toEqual([
      { entity: "shidduchim", pending: ["resume", "photo"] },
    ]);
  });

  // Epic 5's closing story (5.11, AC 6): every entity has landed its full
  // canonical tab set, so the real registry's pending-tab ledger is now
  // asserted empty rather than merely logged. A regression here names the
  // entity that still has a `pendingTabs` key — that is a real Epic 5 gap
  // in that entity's story, not a reason to soften this assertion back to
  // informational.
  it("is empty for the real registry — Epic 5 has landed every canonical tab", () => {
    // Arrange
    const descriptors = descriptorMap(
      ...["shidduchim", "singles", "shadchanim", "references"]
        .map((name) => getEntityDescriptor(name))
        .filter((d): d is EntityDescriptor => d !== undefined),
    );

    // Act
    const ledger = findPendingTabs(descriptors);

    // Assert
    expect(ledger).toEqual([]);
  });
});

describe("findListPathLinks — AC 10b synthetic corpus", () => {
  it("reports a file containing a list-path literal", () => {
    // Arrange
    const files = { "dashboard/Dashboard.tsx": 'to="/references"' };

    // Act / Assert
    expect(findListPathLinks(files, ["references"])).toEqual([
      "dashboard/Dashboard.tsx",
    ]);
  });

  it('reports a file calling buildListPath("<name>")', () => {
    // Arrange
    const files = { "x.tsx": 'buildListPath("references")' };

    // Act / Assert
    expect(findListPathLinks(files, ["references"])).toEqual(["x.tsx"]);
  });

  it("does not report a record path template literal for the same entity", () => {
    // Arrange
    const files = { "x.tsx": "`/references/${id}`" };

    // Act / Assert
    expect(findListPathLinks(files, ["references"])).toEqual([]);
  });
});

/**
 * The enumeration rule (clause b2).
 *
 * The corpus below is not synthetic where it matters: `DASHBOARD_AS_SHIPPED`
 * is the verbatim reference-count from `dashboard/useDashboardData.ts` as it
 * stands on `origin/main` today — the surface the project owner reported as
 * "why is there references in dashboard". It carries no `/references` literal,
 * so `findListPathLinks` returns [] for it; that is precisely why the guard
 * was green over it.
 */
const DASHBOARD_AS_SHIPPED_ON_ORIGIN_MAIN = `
  const { total: totalShadchanim } = useGetList("shadchanim", {
    pagination: { page: 1, perPage: 1 },
  });
  const { total: totalReferences } = useGetList("references", {
    pagination: { page: 1, perPage: 1 },
  });
`;

describe("findBrowseSurfaceEnumeration — the blind spot findListPathLinks left open", () => {
  it("reports the reference count shipped on origin/main's dashboard", () => {
    // Arrange
    const files = {
      "dashboard/useDashboardData.ts": DASHBOARD_AS_SHIPPED_ON_ORIGIN_MAIN,
    };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([
      "dashboard/useDashboardData.ts",
    ]);
  });

  it("PROOF the older rule cannot see it — findListPathLinks passes the same file", () => {
    // Arrange — identical corpus, the path-based matcher.
    const files = {
      "dashboard/useDashboardData.ts": DASHBOARD_AS_SHIPPED_ON_ORIGIN_MAIN,
    };

    // Act / Assert — green over a live violation. This is the whole defect.
    expect(findListPathLinks(files, ["references"])).toEqual([]);
  });

  it("reports a global-search fan-out that adds references back", () => {
    // Arrange — the shape Story 4.5 deliberately left out.
    const files = {
      "misc/useGlobalSearch.ts": `
        Promise.all([
          dataProvider.getList("singles", params),
          dataProvider.getList("references", params),
        ])`,
    };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([
      "misc/useGlobalSearch.ts",
    ]);
  });

  it("reports the summary view name too, since the provider maps the resource onto it", () => {
    // Arrange
    const files = {
      "dashboard/Tile.tsx": 'useGetList("references_summary", {})',
    };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([
      "dashboard/Tile.tsx",
    ]);
  });

  it("sees through an explicit generic argument", () => {
    // Arrange
    const files = {
      "dashboard/Tile.tsx": 'useGetList<Reference>("references", {})',
    };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([
      "dashboard/Tile.tsx",
    ]);
  });

  it("does NOT report fetching a reference by id — addressability is protected by RULING 7 clause 2", () => {
    // Arrange
    const files = {
      "dashboard/Tile.tsx":
        'useGetOne("references", { id }); useGetMany("references", { ids })',
    };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([]);
  });

  it("does NOT report a browse surface enumerating an entity that IS browsable", () => {
    // Arrange
    const files = { "dashboard/Tile.tsx": 'useGetList("shadchanim", {})' };

    // Act / Assert
    expect(findBrowseSurfaceEnumeration(files, ["references"])).toEqual([]);
  });
});

describe("findBrowseShapedIndexes — is the registered index a browse component?", () => {
  it("flags an index built on ra-core's <List> controller", () => {
    // Arrange
    const sources = {
      references: 'import { List } from "@/components/admin/list";',
    };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toEqual([
      "references: imports admin/list (<List>)",
    ]);
  });

  it("flags an index built on the shared EntityList chrome", () => {
    // Arrange
    const sources = { references: "return <EntityList resource=... />;" };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toEqual([
      "references: renders EntityList",
    ]);
  });

  it("flags an index carrying a free-text search box", () => {
    // Arrange
    const sources = {
      references:
        'import { SearchInput } from "@/components/admin/search-input";',
    };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toEqual([
      "references: imports admin/search-input (free-text search)",
    ]);
  });

  it("flags an index carrying the list's unscoped CreateButton", () => {
    // Arrange
    const sources = { references: '<CreateButton label="Add" />' };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toEqual([
      "references: renders <CreateButton>",
    ]);
  });

  it("does NOT flag a bounded, filtered index that merely issues a list query", () => {
    // Arrange — ReferencesIndex's own shape: RULING 7 forbids browsing, not
    // querying, and the §1a panel cannot exist without a query.
    const sources = {
      references:
        'const { data } = useGetList("references", { filter: { "linked_shidduchim_count@eq": 0 } });',
    };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toEqual([]);
  });

  it("reports each entity at most once, naming the first marker found", () => {
    // Arrange
    const sources = {
      references:
        'import { List } from "@/components/admin/list";\nimport { SearchInput } from "@/components/admin/search-input";\n<CreateButton />',
    };

    // Act / Assert
    expect(findBrowseShapedIndexes(sources)).toHaveLength(1);
  });
});

describe("isBrowseSurfaceModule — which modules the enumeration rule covers", () => {
  it("covers every dashboard module and the global-search modules", () => {
    // Act / Assert
    expect(isBrowseSurfaceModule("dashboard/useDashboardData.ts")).toBe(true);
    expect(isBrowseSurfaceModule("dashboard/MobileDashboard.tsx")).toBe(true);
    expect(isBrowseSurfaceModule("misc/useGlobalSearch.ts")).toBe(true);
    expect(isBrowseSurfaceModule("misc/GlobalSearch.tsx")).toBe(true);
  });

  it("leaves the surfaces RULING 7 deliberately keeps outside the rule", () => {
    // Assert — GDPR export, the records-held tally, the merge candidate
    // picker and the §1a unattached panel all enumerate references legitimately.
    expect(isBrowseSurfaceModule("settings/exportFamilyData.ts")).toBe(false);
    expect(isBrowseSurfaceModule("settings/PrivacySection.tsx")).toBe(false);
    expect(isBrowseSurfaceModule("references/ReferenceMergeButton.tsx")).toBe(
      false,
    );
    expect(isBrowseSurfaceModule("references/ReferencesIndex.tsx")).toBe(false);
  });
});

describe("findAd24Violations — AC 10 RULING 7 fixtures", () => {
  it("(b2) reports browse-surface-enumeration for a dashboard module counting a no-browse entity", () => {
    // Arrange — the owner's reported surface, driven through the validator
    // against the REAL NO_BROWSE_SURFACE_ENTITIES table.
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      browseSurfaceEnumerations: ["dashboard/useDashboardData.ts"],
      noBrowseSurfaceEntities: NO_BROWSE_SURFACE_ENTITIES,
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "browse-surface-enumeration",
        subject: "dashboard/useDashboardData.ts",
        detail: expect.stringContaining("references"),
      },
    ]);
  });

  it("(a) reports exactly one browse-surface-on-scoped-entity for the real NO_BROWSE_SURFACE_ENTITIES table", () => {
    // Arrange — the required fixture: a re-added /references nav entry,
    // checked against the REAL NO_BROWSE_SURFACE_ENTITIES table.
    const navTargets = ["/", "/shidduchim", "/references"];
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      navTargets,
      noBrowseSurfaceEntities: NO_BROWSE_SURFACE_ENTITIES,
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "browse-surface-on-scoped-entity",
        subject: "references",
        detail: expect.any(String),
      },
    ]);
  });

  it("(a) — the same navTargets report ZERO violations from findManifestViolations, which is why this rule had to be written", () => {
    // Arrange — references keeps a truthy `list` (the route mount), so
    // routeManifest.ts's own unreachable-nav-target rule waves this
    // straight through.
    const navTargets = ["/", "/shidduchim", "/references"];

    // Act
    const violations = findManifestViolations(
      CUSTOM_ROUTES,
      RESOURCES,
      navTargets,
      RECORD_FLAG_EXEMPTIONS,
    );

    // Assert
    expect(violations).toEqual([]);
  });

  it("(b) reports browse-surface-on-scoped-entity naming the offending file, for a file linking a no-browse list path", () => {
    // Arrange
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      listPathLinks: ["dashboard/Dashboard.tsx"],
      noBrowseSurfaceEntities: NO_BROWSE_SURFACE_ENTITIES,
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "browse-surface-on-scoped-entity",
        subject: "dashboard/Dashboard.tsx",
        detail: expect.stringContaining("references"),
      },
    ]);
  });

  it("(c2) reports browse-surface-on-scoped-entity when a no-browse entity's registered index IS a browse component", () => {
    // Arrange — THE RED FIXTURE for the clause that was missing: the ruling
    // re-opened not by a link and not by a count, but by pointing
    // `references/index.ts`'s `list:` slot back at a list component. Nothing
    // links to it, no dashboard counts it, and every other AC 10 clause
    // stays green — which is exactly why this clause has to exist.
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      browseShapedIndexes: ["references: imports admin/list (<List>)"],
      noBrowseSurfaceEntities: NO_BROWSE_SURFACE_ENTITIES,
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([
      {
        code: "browse-surface-on-scoped-entity",
        subject: "references",
        detail: expect.stringContaining("imports admin/list"),
      },
    ]);
  });

  it("(c2) stays silent for a browse-shaped index on an entity that IS browsable", () => {
    // Arrange — `singles`' index is genuinely browse-shaped and must never
    // be reported; the clause is scoped to NO_BROWSE_SURFACE_ENTITIES.
    const input = baseInput({
      resources: [resourceEntry("references")],
      exemptions: REFERENCES_EXEMPT_FROM_AC2,
      browseShapedIndexes: ["singles: renders EntityList"],
      noBrowseSurfaceEntities: NO_BROWSE_SURFACE_ENTITIES,
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([]);
  });

  it("(c) reports unlisted-entity-missing-index for a resource outside the table with no list", () => {
    // Arrange — no show/create/edit, and exempted from AC 2, so this
    // fixture breaks exactly AC 10(c).
    const input = baseInput({
      resources: [resourceEntry("widgets", {})],
      exemptions: {
        ...EMPTY_EXEMPTIONS,
        descriptorlessResources: {
          widgets: { kind: "permanent", reason: "test fixture" },
        },
      },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "unlisted-entity-missing-index",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });

  it("(d) reports stale-exemption for a table key naming a resource absent from RESOURCES", () => {
    // Arrange
    const input = baseInput({
      noBrowseSurfaceEntities: { widgets: "test fixture" },
    });

    // Act / Assert
    expect(findAd24Violations(input)).toEqual([
      {
        code: "stale-exemption",
        subject: "widgets",
        detail: expect.any(String),
      },
    ]);
  });
});

describe("findAd24Violations — the real manifest + registry", () => {
  it("produces no violations for the real RESOURCES and the real registry", () => {
    // Arrange — real resource manifest and real descriptor registry
    // (populated above via the side-effect imports). `navTargets` and
    // `listPathLinks` are deliberately NOT the real PRIMARY_NAV / a real
    // source scan here: AC 10's real-nav falsifiability is proven by its
    // own dedicated fixture tests above, not this one — PRIMARY_NAV still
    // carries the pre-RULING-7 "/references" entry pending Epic 4 Story 4.4
    // (navigation set), which is outside this story's scope boundary (see
    // AC 10's "Ordering" note). `modalRecordSurfaces` mirrors the real
    // MODAL_RECORD_SURFACES table by construction; the real *scan* finding
    // exactly that set is independently, falsifiably proven in
    // `ad24Conformance.guard.test.ts`.
    const descriptors = new Map(
      RESOURCES.map((r): [string, EntityDescriptor | undefined] => [
        r.name,
        getEntityDescriptor(r.name),
      ]).filter(
        (entry): entry is [string, EntityDescriptor] => entry[1] !== undefined,
      ),
    );

    const input = baseInput({
      resources: RESOURCES,
      descriptors,
      modalRecordSurfaces: Object.keys(MODAL_RECORD_SURFACES),
      handBuiltRecordPaths: [],
      navTargets: [],
      listPathLinks: [],
      exemptions: undefined,
      noBrowseSurfaceEntities: undefined,
    });

    // Act
    const violations = findAd24Violations(input);

    // Assert
    expect(violations).toEqual([]);
  });

  it("sanity check — every no-browse entity's descriptor declares browsable: false, and no other does", () => {
    // Assert — the table (the ruling) and the descriptor field (what the
    // framework fallbacks read: RecordUnavailable, redirectToRecord) must
    // agree in BOTH directions, or one of them drifts alone and a "back to
    // the list" link quietly reopens the surface.
    for (const name of Object.keys(NO_BROWSE_SURFACE_ENTITIES)) {
      expect(getEntityDescriptor(name)?.browsable).toBe(false);
    }
    for (const { name } of RESOURCES) {
      const descriptor = getEntityDescriptor(name);
      if (!descriptor || descriptor.browsable !== false) continue;
      expect(Object.keys(NO_BROWSE_SURFACE_ENTITIES)).toContain(name);
    }
  });

  it("sanity check — NO_BROWSE_SURFACE_ENTITIES names a resource actually present in RESOURCES", () => {
    // Assert — if this ever fails, the AC 10 fixtures above are exercising
    // a table that no longer describes anything real.
    for (const name of Object.keys(NO_BROWSE_SURFACE_ENTITIES)) {
      expect(RESOURCES.some((r) => r.name === name)).toBe(true);
    }
  });
});

import { createElement, type ComponentType } from "react";

import { PRIMARY_NAV, SHADCHANUS_NAV } from "../layout/navItems";
import type { CustomRouteEntry, ResourceEntry } from "./routeManifest";
import {
  CUSTOM_ROUTES,
  RECORD_FLAG_EXEMPTIONS,
  RESOURCES,
  findManifestViolations,
} from "./routeManifest";

/** Every hand-rolled fixture below is testing a code other than
 * `record-flags-missing` / `create-route-on-resource`, so an empty
 * exemption map keeps those two dedicated describe blocks the only place
 * that exercises the exemption argument. */
const NO_EXEMPTIONS: Record<string, string> = {};

const Dummy: ComponentType = () => null;
// A real React element (not a component) — this is the "non-component-route"
// shape a bound `<Navigate to=... />` or a stray `element={<X/>}` would take.
// Built via `createElement` rather than JSX so this file can stay `.ts`.
const anElement = createElement("div") as never;

describe("RECORD_FLAG_EXEMPTIONS — Story 5.1 removed the shidduchim row", () => {
  it("no longer names shidduchim — it registers hasShow explicitly now", () => {
    // Assert — shidduchim/index.ts migrated onto buildEntityRoutes and
    // passes hasShow: true, so the written exemption this row used to
    // record no longer applies. Leaving it would be a stale exemption.
    expect(RECORD_FLAG_EXEMPTIONS).not.toHaveProperty("shidduchim");
  });
});

describe("findManifestViolations", () => {
  it("returns no violations for the real manifest", () => {
    // Arrange
    const navTargets = PRIMARY_NAV.map((item) => item.to);

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

  it("returns no violations for the real manifest fed SHADCHANUS_NAV targets (Story 8.1, Task 5)", () => {
    // Arrange — the validator must hold for both nav sets: /connections
    // (Story 8.1's new placeholder route) must resolve just like every
    // PRIMARY_NAV target does above.
    const navTargets = SHADCHANUS_NAV.map((item) => item.to);

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

  it("reports non-component-route for a custom route whose Component is an element", () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [
      { path: "/x", Component: anElement, surface: "both", chrome: "shell" },
    ];
    const resources: ResourceEntry[] = [
      { name: "tasks", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations(
      customRoutes,
      resources,
      [],
      NO_EXEMPTIONS,
    );

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "non-component-route" && v.surface === "desktop",
      ),
    ).toHaveLength(1);
  });

  it("reports empty-resource for a resource registered with no list, create, edit or show", () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [];
    const resources: ResourceEntry[] = [
      { name: "redts", surface: "both", definition: {} },
      { name: "tasks", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations(
      customRoutes,
      resources,
      [],
      NO_EXEMPTIONS,
    );

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "empty-resource" && v.surface === "desktop",
      ),
    ).toHaveLength(1);
  });

  it("reports duplicate-path when a custom route collides with a resource name", () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [
      { path: "/tasks", Component: Dummy, surface: "both", chrome: "shell" },
    ];
    const resources: ResourceEntry[] = [
      { name: "tasks", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations(
      customRoutes,
      resources,
      [],
      NO_EXEMPTIONS,
    );

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "duplicate-path" && v.surface === "desktop",
      ),
    ).toHaveLength(1);
  });

  it("reports unreachable-nav-target when a nav target's route is dropped from a surface", () => {
    // Arrange: /reminders is only registered on desktop.
    const customRoutes: CustomRouteEntry[] = [
      {
        path: "/reminders",
        Component: Dummy,
        surface: "desktop",
        chrome: "shell",
      },
    ];
    const resources: ResourceEntry[] = [
      { name: "tasks", surface: "both", definition: { list: Dummy } },
    ];
    const navTargets = ["/", "/reminders"];

    // Act
    const violations = findManifestViolations(
      customRoutes,
      resources,
      navTargets,
      NO_EXEMPTIONS,
    );

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "unreachable-nav-target" && v.surface === "mobile",
      ),
    ).toHaveLength(1);
  });

  it("reports tasks-not-listable when the mobile tasks resource has no list", () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [];
    const resources: ResourceEntry[] = [
      { name: "tasks", surface: "desktop", definition: { list: Dummy } },
      { name: "tasks", surface: "mobile", definition: { create: Dummy } },
    ];

    // Act
    const violations = findManifestViolations(
      customRoutes,
      resources,
      [],
      NO_EXEMPTIONS,
    );

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "tasks-not-listable" && v.surface === "mobile",
      ),
    ).toHaveLength(1);
  });
});

describe("findManifestViolations — create-route-on-resource (Story 3.12 AC 7)", () => {
  it("reports create-route-on-resource for an entry whose definition.create is set", () => {
    // Arrange
    const resources: ResourceEntry[] = [
      { name: "widgets", surface: "both", definition: { create: Dummy } },
    ];

    // Act
    const violations = findManifestViolations([], resources, [], NO_EXEMPTIONS);

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "create-route-on-resource" && v.surface === "desktop",
      ),
    ).toHaveLength(1);
  });

  it("does not fire for an entry with no create key", () => {
    // Arrange
    const resources: ResourceEntry[] = [
      { name: "widgets", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations([], resources, [], NO_EXEMPTIONS);

    // Assert
    expect(
      violations.filter((v) => v.code === "create-route-on-resource"),
    ).toHaveLength(0);
  });
});

describe("findManifestViolations — record-flags-missing (Story 3.12 AC 7)", () => {
  it("reports record-flags-missing for a list-only entry with an empty exemption map", () => {
    // Arrange
    const resources: ResourceEntry[] = [
      { name: "widgets", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations([], resources, [], NO_EXEMPTIONS);

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "record-flags-missing" && v.surface === "desktop",
      ),
    ).toHaveLength(1);
  });

  it("does not fire once the entry declares hasShow: true", () => {
    // Arrange
    const resources: ResourceEntry[] = [
      {
        name: "widgets",
        surface: "both",
        definition: { list: Dummy, hasShow: true },
      },
    ];

    // Act
    const violations = findManifestViolations([], resources, [], NO_EXEMPTIONS);

    // Assert
    expect(
      violations.filter((v) => v.code === "record-flags-missing"),
    ).toHaveLength(0);
  });

  it("does not fire for a name carrying a written RECORD_FLAG_EXEMPTIONS entry", () => {
    // Arrange
    const resources: ResourceEntry[] = [
      { name: "widgets", surface: "both", definition: { list: Dummy } },
    ];

    // Act
    const violations = findManifestViolations([], resources, [], {
      widgets: "test fixture — deliberately list-only, no <DataTable> row.",
    });

    // Assert
    expect(
      violations.filter((v) => v.code === "record-flags-missing"),
    ).toHaveLength(0);
  });
});

describe("contextKind (Story 8.1, AC-3)", () => {
  const HOUSEHOLD_GUARDED_RESOURCE_NAMES = [
    "shidduchim",
    "singles",
    "inbox_items",
    "shadchanim",
    "references",
    "tasks",
  ];

  it("sets contextKind: 'household' on every guarded resource, and no others", () => {
    for (const resource of RESOURCES) {
      const expected = HOUSEHOLD_GUARDED_RESOURCE_NAMES.includes(resource.name)
        ? "household"
        : undefined;
      expect(resource.contextKind).toBe(expected);
    }
  });

  it("sets contextKind: 'household' on the reminders custom route, and leaves /connections unguarded", () => {
    const reminders = CUSTOM_ROUTES.find(
      (route) => route.path === "/reminders",
    );
    const connections = CUSTOM_ROUTES.find(
      (route) => route.path === "/connections",
    );

    expect(reminders?.contextKind).toBe("household");
    expect(connections?.contextKind).toBeUndefined();
  });

  it("registers /connections as a real component route (AC-4)", () => {
    const connections = CUSTOM_ROUTES.find(
      (route) => route.path === "/connections",
    );

    expect(connections).toBeDefined();
    expect(connections?.surface).toBe("both");
  });

  it("sets contextKind: 'household' on the /share custom route (review F5)", () => {
    // /share files a household-domain inbox_items row and navigates to the
    // (already guarded) /inbox_items — it must be redirected before the
    // create attempt too, not left reachable and merely bounced afterward.
    const share = CUSTOM_ROUTES.find((route) => route.path === "/share");

    expect(share?.contextKind).toBe("household");
  });
});

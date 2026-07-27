import { createElement, type ComponentType } from "react";

import { PRIMARY_NAV } from "../layout/navItems";
import type { CustomRouteEntry, ResourceEntry } from "./routeManifest";
import {
  CUSTOM_ROUTES,
  RESOURCES,
  findManifestViolations,
} from "./routeManifest";

const Dummy: ComponentType = () => null;
// A real React element (not a component) — this is the "non-component-route"
// shape a bound `<Navigate to=... />` or a stray `element={<X/>}` would take.
// Built via `createElement` rather than JSX so this file can stay `.ts`.
const anElement = createElement("div") as never;

describe("findManifestViolations", () => {
  it("returns no violations for the real manifest", () => {
    // Arrange
    const navTargets = PRIMARY_NAV.map((item) => item.to);

    // Act
    const violations = findManifestViolations(
      CUSTOM_ROUTES,
      RESOURCES,
      navTargets,
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
    const violations = findManifestViolations(customRoutes, resources, []);

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
    const violations = findManifestViolations(customRoutes, resources, []);

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
    const violations = findManifestViolations(customRoutes, resources, []);

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
    const violations = findManifestViolations(customRoutes, resources, []);

    // Assert
    expect(
      violations.filter(
        (v) => v.code === "tasks-not-listable" && v.surface === "mobile",
      ),
    ).toHaveLength(1);
  });
});

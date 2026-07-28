import type { ComponentType } from "react";
import type { ResourceProps } from "ra-core";

import { OAuthConsentPage } from "@/components/supabase/oauth-consent-page";

import { BillingPage } from "../billing/BillingPage";
import inbox from "../inbox";
import { ShareTarget } from "../inbox/ShareTarget";
import { ConfirmationRequired } from "../login/ConfirmationRequired";
import { SignupPage } from "../login/SignupPage";
import references from "../references";
import { RemindersPage } from "../reminders/RemindersPage";
import members from "../members";
import shadchanim from "../shadchanim";
import shidduchim from "../shidduchim";
import { SettingsPage } from "../settings/SettingsPage";
import { SettingsPageMobile } from "../settings/SettingsPageMobile";
import singles from "../singles";
import { TasksListPage } from "../tasks/TasksListPage";

/**
 * Single source of truth for every custom route and resource registered on
 * either admin surface (story 1.5). `CRM.tsx` renders exclusively by mapping
 * over `CUSTOM_ROUTES` / `RESOURCES` via `routesFor` / `resourcesFor` — no
 * `<Route>` or `<Resource>` is written by hand there.
 */

/** Which admin surface(s) an entry is registered on. Always explicit — never omitted. */
export type Surface = "desktop" | "mobile" | "both";

export interface CustomRouteEntry {
  path: string;
  /** A component, never a bound element — a redirect (`<Navigate .../>`) is not expressible. */
  Component: ComponentType;
  surface: Surface;
  /** "bare" = rendered outside the app shell (`<CustomRoutes noLayout>`); "shell" = inside it. */
  chrome: "shell" | "bare";
}

export interface ResourceEntry {
  name: string;
  surface: Surface;
  definition: Omit<ResourceProps, "name">;
}

export const CUSTOM_ROUTES: CustomRouteEntry[] = [
  // Bare (outside the app shell) — identical on both surfaces.
  {
    path: SignupPage.path,
    Component: SignupPage,
    surface: "both",
    chrome: "bare",
  },
  {
    path: ConfirmationRequired.path,
    Component: ConfirmationRequired,
    surface: "both",
    chrome: "bare",
  },
  {
    path: OAuthConsentPage.path,
    Component: OAuthConsentPage,
    surface: "both",
    chrome: "bare",
  },
  // Shell (inside the app shell). Settings differs per surface; the rest is shared.
  {
    path: SettingsPage.path,
    Component: SettingsPage,
    surface: "desktop",
    chrome: "shell",
  },
  {
    path: SettingsPageMobile.path,
    Component: SettingsPageMobile,
    surface: "mobile",
    chrome: "shell",
  },
  {
    path: BillingPage.path,
    Component: BillingPage,
    surface: "both",
    chrome: "shell",
  },
  {
    path: RemindersPage.path,
    Component: RemindersPage,
    surface: "both",
    chrome: "shell",
  },
  {
    path: ShareTarget.path,
    Component: ShareTarget,
    surface: "both",
    chrome: "shell",
  },
];

export const RESOURCES: ResourceEntry[] = [
  { name: "shidduchim", surface: "both", definition: shidduchim },
  { name: "singles", surface: "both", definition: singles },
  { name: "inbox_items", surface: "both", definition: inbox },
  { name: "shadchanim", surface: "both", definition: shadchanim },
  { name: "references", surface: "both", definition: references },
  { name: "tasks", surface: "both", definition: { list: TasksListPage } },
  { name: "members", surface: "desktop", definition: members },
];

function appliesToSurface(
  entrySurface: Surface,
  surface: "desktop" | "mobile",
): boolean {
  return entrySurface === "both" || entrySurface === surface;
}

export function routesFor(
  surface: "desktop" | "mobile",
  chrome: "shell" | "bare",
): CustomRouteEntry[] {
  return CUSTOM_ROUTES.filter(
    (route) =>
      appliesToSurface(route.surface, surface) && route.chrome === chrome,
  );
}

export function resourcesFor(surface: "desktop" | "mobile"): ResourceEntry[] {
  return RESOURCES.filter((resource) =>
    appliesToSurface(resource.surface, surface),
  );
}

// --- Validator (AC #6) ---------------------------------------------------

export type ViolationCode =
  | "non-component-route"
  | "empty-resource"
  | "duplicate-path"
  | "unreachable-nav-target"
  | "tasks-not-listable";

export interface ManifestViolation {
  code: ViolationCode;
  surface: "desktop" | "mobile";
  detail: string;
}

const REACT_LAZY_TYPE = Symbol.for("react.lazy");

/** True for a function component or a `React.lazy(...)` wrapper; false for an
 * element, `null`, `undefined`, or anything else that isn't renderable as a
 * bare `<Component />`. */
function isRenderableComponent(value: unknown): boolean {
  if (typeof value === "function") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    (value as { $$typeof: unknown }).$$typeof === REACT_LAZY_TYPE
  );
}

function isEmptyResourceDefinition(
  definition: ResourceEntry["definition"],
): boolean {
  return (
    !definition.list &&
    !definition.create &&
    !definition.edit &&
    !definition.show
  );
}

const SURFACES: Array<"desktop" | "mobile"> = ["desktop", "mobile"];

/**
 * Pure validator: given a custom-route manifest, a resource manifest and the
 * primary-nav targets, returns every way a registered route could render
 * nothing. Takes its inputs as parameters (never reads `CUSTOM_ROUTES` /
 * `RESOURCES` / `PRIMARY_NAV` from module scope) so tests can drive it with
 * invalid fixtures without mutating the real manifest.
 */
export function findManifestViolations(
  customRoutes: CustomRouteEntry[],
  resources: ResourceEntry[],
  navTargets: string[],
): ManifestViolation[] {
  const violations: ManifestViolation[] = [];

  for (const surface of SURFACES) {
    const routesForSurface = customRoutes.filter((route) =>
      appliesToSurface(route.surface, surface),
    );
    const resourcesForSurface = resources.filter((resource) =>
      appliesToSurface(resource.surface, surface),
    );

    for (const route of routesForSurface) {
      if (!isRenderableComponent(route.Component)) {
        violations.push({
          code: "non-component-route",
          surface,
          detail: `"${route.path}" does not resolve to a renderable component`,
        });
      }
    }

    for (const resource of resourcesForSurface) {
      if (isEmptyResourceDefinition(resource.definition)) {
        violations.push({
          code: "empty-resource",
          surface,
          detail: `resource "${resource.name}" declares no list, create, edit or show`,
        });
      }
    }

    const pathCounts = new Map<string, number>();
    for (const path of [
      ...routesForSurface.map((route) => route.path),
      ...resourcesForSurface.map((resource) => `/${resource.name}`),
    ]) {
      pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }
    for (const [path, count] of pathCounts) {
      if (count > 1) {
        violations.push({
          code: "duplicate-path",
          surface,
          detail: `"${path}" is claimed by ${count} entries`,
        });
      }
    }

    const routePaths = new Set(routesForSurface.map((route) => route.path));
    const listableResourceNames = new Set(
      resourcesForSurface
        .filter((resource) => !!resource.definition.list)
        .map((resource) => resource.name),
    );
    for (const target of navTargets) {
      const resourceName = target.replace(/^\//, "");
      const isReachable =
        target === "/" ||
        routePaths.has(target) ||
        listableResourceNames.has(resourceName);
      if (!isReachable) {
        violations.push({
          code: "unreachable-nav-target",
          surface,
          detail: `"${target}" does not resolve to a rendered screen`,
        });
      }
    }

    const tasksResource = resourcesForSurface.find(
      (resource) => resource.name === "tasks",
    );
    if (!tasksResource?.definition.list) {
      violations.push({
        code: "tasks-not-listable",
        surface,
        detail: `"/tasks" does not resolve to a resource with a list`,
      });
    }
  }

  return violations;
}

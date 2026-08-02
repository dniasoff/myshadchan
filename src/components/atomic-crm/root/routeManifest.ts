import type { ComponentType } from "react";
import type { ResourceProps } from "ra-core";

import { OAuthConsentPage } from "@/components/supabase/oauth-consent-page";

import { BillingPage } from "../billing/BillingPage";
import { ConnectionAccept } from "../connections/ConnectionAccept";
import { ConnectionsPlaceholder } from "../connections/ConnectionsPlaceholder";
import inbox from "../inbox";
import { ShareTarget } from "../inbox/ShareTarget";
import type { ContextKind } from "../layout/navItems";
import { InviteAcceptance } from "../login/InviteAcceptance";
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
  /**
   * Story 8.1 (AC-3): which active-context kind this route requires — read
   * by `root/CRM.tsx`'s `renderCustomRoutes`, which wraps the entry's
   * `Component` in `<RequireContextKind>` when set. Omitted entirely for a
   * route reachable regardless of context kind (most of them). Distinct
   * from `surface` (desktop/mobile/both) — that field is already taken by
   * the 1.5 manifest for a different axis.
   */
  contextKind?: ContextKind;
}

export interface ResourceEntry {
  name: string;
  surface: Surface;
  definition: Omit<ResourceProps, "name">;
  /** Story 8.1 (AC-3): see `CustomRouteEntry.contextKind` — same field,
   * same wrapping mechanism, applied to `<Resource>`'s `list` slot by
   * `root/CRM.tsx`'s `renderResources` instead of a `<Route>` element. */
  contextKind?: ContextKind;
}

export const CUSTOM_ROUTES: CustomRouteEntry[] = [
  // Bare (outside the app shell) — identical on both surfaces.
  {
    path: InviteAcceptance.path,
    Component: InviteAcceptance,
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
    contextKind: "household",
  },
  // Story 8.1 review fix (F5): files a household-domain `inbox_items` row
  // and navigates to the (already guarded) `/inbox_items` — a shadchanus
  // caller reaching this via a PWA share-target intent must be redirected
  // before the create attempt, not after, the same way every other
  // household-only surface is.
  {
    path: ShareTarget.path,
    Component: ShareTarget,
    surface: "both",
    chrome: "shell",
    contextKind: "household",
  },
  // Story 8.1 (AC-4): a rendered placeholder, never a dead nav target —
  // Story 8.5 replaces this entry with the real descriptor-based resource.
  // Deliberately no `contextKind` yet: 8.1 only guards the household-only
  // side (AC-3's 7-entry list below); 8.5 is what sets `contextKind:
  // "shadchanus"` on the real `connections` resource.
  {
    path: ConnectionsPlaceholder.path,
    Component: ConnectionsPlaceholder,
    surface: "both",
    chrome: "shell",
  },
  // Story 8.2 (Task 6): the accept half of the consent workflow. Reachable
  // regardless of the caller's active context kind — either side may be the
  // acceptor, depending on who generated the invite (no `contextKind`,
  // mirroring ConnectionsPlaceholder above). `chrome: "shell"`, not "bare"
  // like `InviteAcceptance` — unlike that story's brand-new-user signup
  // flow, accepting a connection requires an ALREADY-authenticated caller
  // (Task 3's own grant note), so the ordinary authenticated app shell is
  // the right chrome, not a pre-auth standalone page.
  {
    path: ConnectionAccept.path,
    Component: ConnectionAccept,
    surface: "both",
    chrome: "shell",
  },
];

export const RESOURCES: ResourceEntry[] = [
  {
    name: "shidduchim",
    surface: "both",
    definition: shidduchim,
    contextKind: "household",
  },
  {
    name: "singles",
    surface: "both",
    definition: singles,
    contextKind: "household",
  },
  {
    name: "inbox_items",
    surface: "both",
    definition: inbox,
    contextKind: "household",
  },
  {
    name: "shadchanim",
    surface: "both",
    definition: shadchanim,
    contextKind: "household",
  },
  {
    name: "references",
    surface: "both",
    definition: references,
    contextKind: "household",
  },
  {
    name: "tasks",
    surface: "both",
    definition: { list: TasksListPage },
    contextKind: "household",
  },
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

/**
 * Resource name -> the written reason it needs no `hasShow`/`hasEdit` flags
 * despite registering `list` only (Story 3.12 AC 7). `ra-core` computes
 * `hasEdit: !!edit || !!hasEdit`, `hasShow: !!show || !!hasShow`
 * (`ra-core/dist/core/Resource.js:28-34`); without either flag,
 * `useGetPathForRecordCallback` never resolves a link and every
 * `<DataTable>` row goes unclickable (`admin/data-table.tsx:233`). Exactly
 * these two entries, and no others — a third list-only resource needs its
 * own written reason here, not a silent addition. `shidduchim` was the
 * third entry until Story 5.1 migrated it onto `buildEntityRoutes` and
 * added `hasShow: true` explicitly, in the same diff that removed its row.
 */
export const RECORD_FLAG_EXEMPTIONS: Record<string, string> = {
  inbox_items:
    "Triage surface only (InboxList.tsx): each card resolves via a dialog or is dismissed, never through <DataTable>, and there is no inbox_items/{id} record route to link a row to.",
  tasks:
    "Read/complete-only list (TasksListPage.tsx): tasks are toggled inline, never through <DataTable>, and there is no tasks/{id} record route — task creation lives in reminders/.",
};

// --- Validator (AC #6, extended by Story 3.12 AC #7) ----------------------

export type ViolationCode =
  | "non-component-route"
  | "empty-resource"
  | "duplicate-path"
  | "unreachable-nav-target"
  | "tasks-not-listable"
  | "create-route-on-resource"
  | "record-flags-missing";

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
 * Pure validator: given a custom-route manifest, a resource manifest, the
 * primary-nav targets and the record-flag exemption map, returns every way a
 * registered route could render nothing, or could register a route the AD-24
 * convention no longer allows. Takes its inputs as parameters (never reads
 * `CUSTOM_ROUTES` / `RESOURCES` / `PRIMARY_NAV` / `RECORD_FLAG_EXEMPTIONS`
 * from module scope) so tests can drive it with invalid fixtures without
 * mutating the real manifest.
 */
export function findManifestViolations(
  customRoutes: CustomRouteEntry[],
  resources: ResourceEntry[],
  navTargets: string[],
  recordFlagExemptions: Record<string, string>,
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

      // AD-24 (Story 3.12 AC 7): creation lives at `new`, owned by the
      // entity's own route fragment (`entity360/routeConvention.tsx`'s
      // `buildCreateRoutes`), never `<Resource>`'s own `create` prop.
      if (resource.definition.create) {
        violations.push({
          code: "create-route-on-resource",
          surface,
          detail: `resource "${resource.name}" declares a create route on <Resource> — creation lives at "new" (buildCreateRoutes), not "create"`,
        });
      }

      // AD-24 (Story 3.12 AC 7): a list-only registration with neither a
      // show/edit component nor an explicit hasShow/hasEdit flag leaves
      // every <DataTable> row unclickable, unless it is a written exemption.
      const { list, show, edit, hasShow, hasEdit } = resource.definition;
      const hasRecordFlags = !!show || !!edit || !!hasShow || !!hasEdit;
      if (list && !hasRecordFlags && !(resource.name in recordFlagExemptions)) {
        violations.push({
          code: "record-flags-missing",
          surface,
          detail: `resource "${resource.name}" registers list only, with no hasShow/hasEdit and no RECORD_FLAG_EXEMPTIONS entry — every <DataTable> row would be unclickable`,
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

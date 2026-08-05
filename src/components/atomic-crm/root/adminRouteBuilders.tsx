import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  createElement,
} from "react";
import type { DashboardComponent } from "ra-core";
import { Resource } from "ra-core";
import { Route, type RouteProps } from "react-router";

import { ShadchanDashboard } from "../dashboard/ShadchanDashboard";
import { useActiveContextKind, type ContextKind } from "../layout/navItems";
import { RequireContextKind } from "../layout/RequireContextKind";
import type { CustomRouteEntry, ResourceEntry } from "./routeManifest";

/**
 * `root/CRM.tsx`'s route/resource-wiring helpers, split into their own
 * (non-component) module purely so `react-refresh/only-export-components`
 * doesn't flag `CRM.tsx` for mixing them with its `CRM` component export —
 * the same reason `entity360/routeConvention.tsx` keeps its own plain
 * functions apart from `LegacyCreatePathRedirect`, and `singles/singleLabels.ts`
 * / `shidduchim/shidduchAge.ts` / `misc/useGlobalSearch.ts` all exist. This
 * repo's `src/components/atomic-crm` suppression budget
 * (`scripts/check-suppressions.mjs`) is already fully spent (3/3), so an
 * inline `eslint-disable` here was not an option — extraction is the only
 * conforming fix.
 *
 * `CRM.tsx` is still the only place these are wired into `<Admin>`; this
 * module only builds the elements/functions it hands back.
 */

/** The sole place `<Route>` elements are written for `root/CRM.tsx`'s custom
 * routes — reused for every surface/chrome combination by mapping over
 * `routeManifest.ts`. Story 8.1 (AC-3): an entry carrying `contextKind` gets
 * wrapped in `<RequireContextKind>` here — the manifest never renders a raw
 * `<Route>` with ad-hoc guard logic of its own.
 *
 * Exported for `CRM.test.tsx` (Story 8.1 review F1): before that file
 * existed, nothing outside `CRM.tsx` ever called this function, so deleting
 * or misconfiguring the guard it applies left every existing test green. */
export const renderCustomRoutes = (entries: CustomRouteEntry[]) =>
  entries.map(({ path, Component, contextKind }) => (
    <Route
      path={path}
      key={path}
      element={
        contextKind ? (
          <RequireContextKind kind={contextKind} redirectTo="/">
            <Component />
          </RequireContextKind>
        ) : (
          <Component />
        )
      }
    />
  ));

/** A `<Resource>` `list`/`edit`/`show`/`create` slot's value type
 * (`ra-core/src/types.ts`'s own `ComponentType<any> | ReactElement` union),
 * narrowed to non-`undefined` — exactly what `renderResources` below has in
 * hand once it has checked `definition.list` is set. */
type ResourceSlotValue = NonNullable<ResourceEntry["definition"]["list"]>;

/** Normalizes a `<Resource>` slot value to an element, mirroring
 * `ra-core/src/core/Resource.tsx`'s own private `getElement` — needed here
 * because `renderResources` below wraps the element in
 * `<RequireContextKind>` before handing it back to `<Resource>`. */
function toElement(elementOrComponent: ResourceSlotValue): ReactElement {
  return isValidElement(elementOrComponent)
    ? elementOrComponent
    : createElement(elementOrComponent as ComponentType);
}

/**
 * Story 8.1 review fix (F2): `renderResources`'s `<RequireContextKind>` wrap
 * originally covered only a resource's `list` slot. `singles`, `shadchanim`
 * and `references` each also supply `children:
 * buildCreateRoutes(name, XCreate)` (`entity360/routeConvention.tsx`) — a
 * literal `<Route path="new/*">` / `<Route path="create/*">` pair that
 * `<Resource>` renders as SIBLINGS of `list` inside its own internal
 * `<Routes>` (`ra-core/src/core/Resource.tsx`), so a shadchanus-active
 * caller could still reach `/{entity}/new` (and, via the legacy redirect,
 * `/{entity}/create`) un-redirected.
 *
 * This cannot wrap the `<Route>` elements themselves in
 * `<RequireContextKind>`: react-router's `createRoutesFromChildren`
 * (`node_modules/react-router/dist/development/chunk-*.mjs`) throws an
 * invariant violation unless every child of `<Routes>` is a literal
 * `<Route>` or `<React.Fragment>` — the exact reason this story's first
 * pass left `children` unwrapped. Guarding the *element the route renders*
 * instead keeps the `<Route>` shape `<Routes>` requires while still
 * enforcing AC-3: a mismatched context never mounts the wrapped element,
 * only `<RequireContextKind>`'s own `<Navigate>`.
 *
 * Recurses through a `<React.Fragment>` (what `buildCreateRoutes` itself
 * returns) so the guard is not defeated by that one extra wrapper layer;
 * any other child (e.g. the `null` `buildCreateRoutes` produces for its
 * optional `New`) passes through unchanged. Contract §5 rule 8 forbids
 * nesting the guard per-route inside `buildEntityRoutes` — this never
 * touches `buildEntityRoutes`'s own routes (the `list` slot above already
 * covers all of them), only `buildCreateRoutes`'s, which the rule does not
 * mention.
 */
function guardDescendantRoutes(
  node: ReactNode,
  kind: ContextKind,
  redirectTo: string,
): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;

    if (child.type === Fragment) {
      const { children: fragmentContents } = child.props as {
        children?: ReactNode;
      };
      return cloneElement(
        child,
        undefined,
        guardDescendantRoutes(fragmentContents, kind, redirectTo),
      );
    }

    if (child.type !== Route) return child;

    const { element } = child.props as RouteProps;
    return cloneElement(child as ReactElement<RouteProps>, {
      element: (
        <RequireContextKind kind={kind} redirectTo={redirectTo}>
          {element}
        </RequireContextKind>
      ),
    });
  });
}

/** The sole place `<Resource>` elements are written — reused for both
 * surfaces by mapping over `routeManifest.ts`. Story 8.1 (AC-3): a
 * `contextKind` entry gets its `list` slot, AND its `children` slot
 * (F2 above — `new`/`create` routes), wrapped in `<RequireContextKind>`.
 * `edit` / `show` stay untouched because none of these resources set them
 * at the `<Resource>` level (they route through `list`'s own
 * `buildEntityRoutes` instead).
 *
 * Exported for `CRM.test.tsx` (Story 8.1 review F1). */
export const renderResources = (entries: ResourceEntry[]) =>
  entries.map(({ name, definition, contextKind }) => (
    <Resource
      name={name}
      key={name}
      {...definition}
      list={
        contextKind && definition.list ? (
          <RequireContextKind kind={contextKind} redirectTo="/">
            {toElement(definition.list)}
          </RequireContextKind>
        ) : (
          definition.list
        )
      }
      children={
        contextKind
          ? guardDescendantRoutes(definition.children, contextKind, "/")
          : definition.children
      }
    />
  ));

/**
 * Story 8.1 (AC-5/Task 4): the dashboard-route picker — one factory, meant
 * to be instantiated once per surface at `CRM.tsx`'s module scope, rather
 * than two ad-hoc branches forked into `DesktopAdmin` and `MobileAdmin`
 * separately. Renders `ShadchanDashboard` when the active context is
 * `shadchanus`, else the household dashboard passed in (`Dashboard` on
 * desktop, `MobileDashboard` on mobile) — including while
 * `useActiveContextKind()` is still resolving, so a login mid-load never
 * flashes the shadchanus empty state first.
 *
 * Must be called once per surface at module scope, not inside
 * `DesktopAdmin`/`MobileAdmin`'s render body: `<Admin dashboard={...}>`
 * relies on the component's identity staying stable across renders
 * (`ra-core`'s `WithPermissions` remounts whenever `component` changes
 * identity), so the returned component must not be re-created on every
 * render.
 *
 * `HouseholdDashboard` is typed as a bare zero-props `ComponentType`, not
 * `DashboardComponent` (`ComponentType<{ permissions: any }>`) — `Dashboard`
 * and `MobileDashboard` take no props, and this function instantiates it
 * directly as JSX (`<HouseholdDashboard />`), which — unlike merely passing
 * a component through as a value — makes the TS JSX checker enforce
 * whatever prop type it's declared with here.
 *
 * Exported for `CRM.test.tsx` (Story 8.1 review F3): before that file
 * existed, nothing ever asserted that `/` under an active shadchanus
 * context actually renders `ShadchanDashboard` — deleting this picker
 * entirely (always rendering the household dashboard) left every existing
 * test green.
 */
export function buildDashboardRoute(
  HouseholdDashboard: ComponentType,
): DashboardComponent {
  const DashboardRoute: DashboardComponent = () => {
    const kind = useActiveContextKind();
    return kind === "shadchanus" ? (
      <ShadchanDashboard />
    ) : (
      <HouseholdDashboard />
    );
  };
  return DashboardRoute;
}

/**
 * `CRM.tsx`'s wrapped `authProvider.login()` prefetches `configuration` "to
 * avoid a flickering when accessing the app for the first time" — but only
 * a COMPLETED sign-in (an OTP code actually verified via `verifyOtp`) ever
 * establishes a session. The OTP flow's "Send code" step (`requestOtp`) and
 * an OAuth click (`oauthProvider`, about to navigate away to Google) both
 * resolve `authProvider.login()` too, without ever authenticating anyone —
 * prefetching for either is a request guaranteed to 406 against
 * `configuration`'s `authenticated`-only RLS policy (`05_policies.sql`):
 * harmless (the caller's own `catch` discards it), but a wasted, visibly-red
 * network call on every single "Send code" click.
 */
export function shouldPrefetchConfigOnLogin(params: unknown): boolean {
  return (
    typeof params === "object" &&
    params !== null &&
    (params as { verifyOtp?: unknown }).verifyOtp === true
  );
}

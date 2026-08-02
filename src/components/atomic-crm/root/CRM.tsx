import type { ComponentType, ReactElement } from "react";
import type {
  CoreAdminProps,
  AuthProvider,
  DashboardComponent,
  LayoutComponent,
} from "ra-core";
import { CustomRoutes, Resource } from "ra-core";
import { isValidElement, createElement, useEffect, useMemo } from "react";
import { Route } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { Admin } from "@/components/admin/admin";
import { AccessDenied } from "@/components/admin/access-denied";
import { AuthenticationError } from "@/components/admin/authentication-error";

import { Dashboard } from "../dashboard/Dashboard";
import { MobileDashboard } from "../dashboard/MobileDashboard";
import { ShadchanDashboard } from "../dashboard/ShadchanDashboard";
import { Layout } from "../layout/Layout";
import { MobileLayout } from "../layout/MobileLayout";
import { useActiveContextKind } from "../layout/navItems";
import { RequireContextKind } from "../layout/RequireContextKind";
import {
  getAuthProvider as defaultAuthProviderBuilder,
  getDataProvider as defaultDataProviderBuilder,
} from "../providers/supabase";
import {
  CONFIGURATION_STORE_KEY,
  type ConfigurationContextValue,
} from "./ConfigurationContext";
import { createCrmStore } from "./crmStore";
import type { CrmDataProvider } from "../providers/types";
import {
  defaultDarkModeLogo,
  defaultLightModeLogo,
  defaultTaskTypes,
  defaultTitle,
} from "./defaultConfiguration";
import { i18nProvider as defaulti18nProvider } from "../providers/commons/i18nProvider";
import { LoginPage } from "../login/LoginPage.tsx";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import type { CustomRouteEntry, ResourceEntry } from "./routeManifest";
import { routesFor, resourcesFor } from "./routeManifest";

const defaultStore = createCrmStore();

/** The sole place `<Route>` elements are written — reused for every
 * surface/chrome combination by mapping over `routeManifest.ts`. Story 8.1
 * (AC-3): an entry carrying `contextKind` gets wrapped in
 * `<RequireContextKind>` here — the manifest never renders a raw
 * `<Route>` with ad-hoc guard logic of its own. */
const renderCustomRoutes = (entries: CustomRouteEntry[]) =>
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

/** The sole place `<Resource>` elements are written — reused for both
 * surfaces by mapping over `routeManifest.ts`. Story 8.1 (AC-3): a
 * `contextKind` entry gets its `list` slot wrapped in
 * `<RequireContextKind>` — every guarded resource in this manifest (Task 3)
 * registers `list` only, so this is the one slot that needs it; `edit` /
 * `show` / `create` stay untouched because none of those resources set
 * them at the `<Resource>` level (they route through `list`'s own
 * `buildEntityRoutes`/`children` instead). */
const renderResources = (entries: ResourceEntry[]) =>
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
    />
  ));

/**
 * Story 8.1 (AC-5/Task 4): the dashboard-route picker — one factory,
 * instantiated once per surface below, rather than two ad-hoc branches
 * forked into `DesktopAdmin` and `MobileAdmin` separately. Renders
 * `ShadchanDashboard` when the active context is `shadchanus`, else the
 * household dashboard passed in (`Dashboard` on desktop, `MobileDashboard`
 * on mobile) — including while `useActiveContextKind()` is still resolving,
 * so a login mid-load never flashes the shadchanus empty state first.
 *
 * Defined at module scope and called once per surface (not inside
 * `DesktopAdmin`/`MobileAdmin`'s render body): `<Admin dashboard={...}>`
 * relies on the component's identity staying stable across renders
 * (`ra-core`'s `WithPermissions` remounts whenever `component` changes
 * identity), so this must not be re-created on every render.
 *
 * `HouseholdDashboard` is typed as a bare zero-props `ComponentType`, not
 * `DashboardComponent` (`ComponentType<{ permissions: any }>`) — `Dashboard`
 * and `MobileDashboard` take no props, and this function instantiates it
 * directly as JSX (`<HouseholdDashboard />`), which — unlike merely passing
 * a component through as a value — makes the TS JSX checker enforce
 * whatever prop type it's declared with here.
 */
function buildDashboardRoute(
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

const DesktopDashboardRoute = buildDashboardRoute(Dashboard);
const MobileDashboardRoute = buildDashboardRoute(MobileDashboard);

export type CRMProps = {
  dataProvider?: CrmDataProvider;
  authProvider?: AuthProvider;
  i18nProvider?: CoreAdminProps["i18nProvider"];
  disableTelemetry?: boolean;
  store?: CoreAdminProps["store"];
  dashboard?: DashboardComponent;
  layout?: LayoutComponent;
} & Partial<ConfigurationContextValue>;

/**
 * CRM Component
 *
 * This component sets up and renders the main CRM application using `ra-core`. It provides
 * default configurations and themes but allows for customization through props. The component
 * seeds the store with any custom prop values for backwards compatibility.
 *
 * @param {RaThemeOptions} darkTheme - The theme to use when the application is in dark mode.
 * @param {RaThemeOptions} lightTheme - The theme to use when the application is in light mode.
 * @param {string} logo - The logo used in the CRM application.
 * @param {LabeledValue[]} taskTypes - The types of tasks used in the application.
 * @param {string} title - The title of the CRM application.
 *
 * @returns {JSX.Element} The rendered CRM application.
 *
 * @example
 * // Basic usage of the CRM component
 * import { CRM } from '@/components/atomic-crm/dashboard/CRM';
 *
 * const App = () => (
 *     <CRM
 *         logo="/path/to/logo.png"
 *         title="My Custom CRM"
 *         lightTheme={{
 *             ...defaultTheme,
 *             palette: {
 *                 primary: { main: '#0000ff' },
 *             },
 *         }}
 *     />
 * );
 *
 * export default App;
 */
export const CRM = ({
  darkModeLogo = defaultDarkModeLogo,
  lightModeLogo = defaultLightModeLogo,
  taskTypes = defaultTaskTypes,
  title = defaultTitle,
  dataProvider = defaultDataProviderBuilder(),
  authProvider = defaultAuthProviderBuilder(),
  i18nProvider = defaulti18nProvider,
  store = defaultStore,
  disableTelemetry,
  ...rest
}: CRMProps) => {
  useEffect(() => {
    if (
      disableTelemetry ||
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      typeof window.location === "undefined" ||
      typeof Image === "undefined"
    ) {
      return;
    }
    const img = new Image();
    img.src = `https://atomic-crm-telemetry.marmelab.com/atomic-crm-telemetry?domain=${window.location.hostname}`;
  }, [disableTelemetry]);

  // Seed the store with CRM prop values if not already stored
  // (backwards compatibility for prop-based config)
  useEffect(() => {
    if (!store.getItem(CONFIGURATION_STORE_KEY)) {
      store.setItem(CONFIGURATION_STORE_KEY, {
        taskTypes,
        title,
        darkModeLogo,
        lightModeLogo,
      } satisfies ConfigurationContextValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const isMobile = useIsMobile();

  // on login, pre-fetch the configuration to avoid a flickering
  // when accessing the app for the first time
  const wrappedAuthProvider = useMemo<AuthProvider>(
    () => ({
      ...authProvider,
      login: async (params: any) => {
        const result = await authProvider.login(params);
        try {
          const config = await dataProvider.getConfiguration();
          if (Object.keys(config).length > 0) {
            store.setItem(CONFIGURATION_STORE_KEY, config);
          }
        } catch {
          // Non-critical: config will load via useConfigurationLoader
        }
        return result;
      },
      handleCallback: async (params: any) => {
        if (!authProvider.handleCallback) {
          throw new Error(
            "handleCallback is not implemented in the authProvider",
          );
        }
        const result = await authProvider.handleCallback(params);
        try {
          const config = await dataProvider.getConfiguration();
          if (Object.keys(config).length > 0) {
            store.setItem(CONFIGURATION_STORE_KEY, config);
          }
        } catch {
          // Non-critical: config will load via useConfigurationLoader
        }
        return result;
      },
      logout: async (params: any) => {
        try {
          store.removeItem(CONFIGURATION_STORE_KEY);
        } catch {
          // Ignore
        }
        return authProvider.logout(params);
      },
    }),
    [authProvider, dataProvider, store],
  );

  const ResponsiveAdmin = isMobile ? MobileAdmin : DesktopAdmin;

  return (
    <ResponsiveAdmin
      dataProvider={dataProvider}
      authProvider={wrappedAuthProvider}
      i18nProvider={i18nProvider}
      store={store}
      loginPage={LoginPage}
      requireAuth
      disableTelemetry
      {...rest}
    />
  );
};

const DesktopAdmin = (
  props: CoreAdminProps & {
    dashboard?: DashboardComponent;
    layout?: LayoutComponent;
  },
) => {
  return (
    <Admin
      layout={props.layout ?? Layout}
      dashboard={props.dashboard ?? DesktopDashboardRoute}
      accessDenied={AccessDenied}
      authenticationError={AuthenticationError}
      {...props}
    >
      <CustomRoutes noLayout>
        {renderCustomRoutes(routesFor("desktop", "bare"))}
      </CustomRoutes>
      <CustomRoutes>
        {renderCustomRoutes(routesFor("desktop", "shell"))}
      </CustomRoutes>
      {renderResources(resourcesFor("desktop"))}
    </Admin>
  );
};

const MobileAdmin = (
  props: CoreAdminProps & {
    dashboard?: DashboardComponent;
    layout?: LayoutComponent;
  },
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
        networkMode: "offlineFirst",
      },
      mutations: {
        networkMode: "offlineFirst",
      },
    },
  });
  const asyncStoragePersister = createAsyncStoragePersister({
    storage: localStorage,
  });

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister }}
    >
      <Admin
        queryClient={queryClient}
        layout={props.layout ?? MobileLayout}
        dashboard={props.dashboard ?? MobileDashboardRoute}
        accessDenied={AccessDenied}
        authenticationError={AuthenticationError}
        {...props}
      >
        <CustomRoutes noLayout>
          {renderCustomRoutes(routesFor("mobile", "bare"))}
        </CustomRoutes>
        <CustomRoutes>
          {renderCustomRoutes(routesFor("mobile", "shell"))}
        </CustomRoutes>
        {renderResources(resourcesFor("mobile"))}
      </Admin>
    </PersistQueryClientProvider>
  );
};

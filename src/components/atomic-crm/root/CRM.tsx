import type {
  CoreAdminProps,
  AuthProvider,
  DashboardComponent,
  LayoutComponent,
} from "ra-core";
import { CustomRoutes } from "ra-core";
import { useEffect, useMemo } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { Admin } from "@/components/admin/admin";
import { AccessDenied } from "@/components/admin/access-denied";
import { AuthenticationError } from "@/components/admin/authentication-error";

import { Dashboard } from "../dashboard/Dashboard";
import { MobileDashboard } from "../dashboard/MobileDashboard";
import { Layout } from "../layout/Layout";
import { MobileLayout } from "../layout/MobileLayout";
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
import { routesFor, resourcesFor } from "./routeManifest";
import {
  buildDashboardRoute,
  renderCustomRoutes,
  renderResources,
  shouldPrefetchConfigOnLogin,
} from "./adminRouteBuilders";

const defaultStore = createCrmStore();

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
        if (shouldPrefetchConfigOnLogin(params)) {
          try {
            const config = await dataProvider.getConfiguration();
            if (Object.keys(config).length > 0) {
              store.setItem(CONFIGURATION_STORE_KEY, config);
            }
          } catch {
            // Non-critical: config will load via useConfigurationLoader
          }
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

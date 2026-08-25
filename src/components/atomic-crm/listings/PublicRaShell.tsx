import { useState } from "react";
import type { ReactNode } from "react";
import { CoreAdminContext } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { i18nProvider } from "../providers/commons/i18nProvider";
import { getDataProvider } from "../providers/supabase";

/**
 * The ra-core context the two public purge pages need, and did not have.
 *
 * `PurgeRequestPage` and `PurgeRequestVerifyPage` call `useDataProvider()`,
 * `useNotify()` and `useTranslate()`, but `App.tsx` renders them BEFORE
 * `<LandingGate>`/`<CRM>` — deliberately, because they must work without a
 * session — and therefore outside every provider `<Admin>` sets up. The
 * result shipped to production as a completely blank page: `useDataProvider`
 * reaches for React Query and throws "No QueryClient set, use
 * QueryClientProvider to set one" during render, which the error boundary
 * above cannot recover into anything visible.
 *
 * It survived review because each page's own test supplies exactly this
 * context (`PurgeRequestPage.test.tsx`'s `renderPage` wraps in
 * `CoreAdminContext` with a `QueryClient`) — the tests were green precisely
 * because they provided what the application did not. The guard that cannot
 * lie is a test that renders `<App url={…}/>` and asserts the form appears;
 * `AppProps.url` exists for that.
 *
 * `getDataProvider` is imported from `../providers/supabase` — the same
 * specifier `root/CRM.tsx` uses — rather than picking a provider here, so
 * these pages can never disagree with the app about which backend they talk
 * to. (The FakeRest demo has its own entry point, `demo/App.tsx`, and never
 * renders this file.)
 *
 * Deliberately no `<Notification>` host: it pulls in `useTheme` and the theme
 * store, which a public unauthenticated page should not need. `notify()` here
 * queues into the context and is simply never displayed — acceptable because
 * both pages carry their own inline `role="alert"` / success state, which is
 * the feedback a visitor actually reads.
 */

export const PublicRaShell = ({ children }: { children: ReactNode }) => {
  // Built on first render and kept for the life of the page, NOT at module
  // scope. `getDataProvider()` reads `VITE_SUPABASE_URL` and throws if it is
  // absent, so constructing it on import would make merely importing this
  // module fail — which is exactly what the new `App.test.tsx` case caught.
  // `root/CRM.tsx` has the same property for the same reason: it builds its
  // provider in a default parameter, evaluated per render, never on import.
  const [dataProvider] = useState(getDataProvider);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <CoreAdminContext
      dataProvider={dataProvider}
      i18nProvider={i18nProvider}
      queryClient={queryClient}
    >
      {children}
    </CoreAdminContext>
  );
};

import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/** Single source of truth for `accounts.demo` on the client — a `["accountDemo"]`
 * query shared (by cache key) between `OnboardingGate` and `DemoBanner` so
 * signing in only ever triggers one `current_account_demo()` RPC call. */
export const ACCOUNT_DEMO_QUERY_KEY = ["accountDemo"] as const;

export const useAccountDemo = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ACCOUNT_DEMO_QUERY_KEY,
    queryFn: () => dataProvider.currentAccountDemo(),
  });
};

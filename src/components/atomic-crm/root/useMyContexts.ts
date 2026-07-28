import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/** Single source of truth for "which contexts can I switch to" on the
 * client — a `["myContexts"]` query the `ContextSwitcher` reads so every
 * mount (desktop `TopBar`, mobile `SettingsPageMobile`) shares one
 * `my_contexts()` RPC call and one cache entry. */
export const MY_CONTEXTS_QUERY_KEY = ["myContexts"] as const;

export const useMyContexts = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: MY_CONTEXTS_QUERY_KEY,
    queryFn: () => dataProvider.getMyContexts(),
  });
};

import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/** Single source of truth for "what am I" on the client — a `["myPersonas"]`
 * query shared (by cache key) between `OnboardingGate` and the onboarding
 * screen so signing in only ever triggers one `my_personas()` RPC call. */
export const MY_PERSONAS_QUERY_KEY = ["myPersonas"] as const;

export const useMyPersonas = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: MY_PERSONAS_QUERY_KEY,
    queryFn: () => dataProvider.getMyPersonas(),
  });
};

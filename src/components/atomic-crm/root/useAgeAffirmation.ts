import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/**
 * Whether this login still owes the 18+ affirmation. Its own cache key so
 * `OnboardingGate` re-reads it exactly once per session, alongside
 * `["myPersonas"]` and `["myContexts"]`.
 */
export const AGE_AFFIRMATION_QUERY_KEY = ["ageAffirmationPending"] as const;

export const useAgeAffirmation = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: AGE_AFFIRMATION_QUERY_KEY,
    queryFn: () => dataProvider.ageAffirmationPending(),
  });
};

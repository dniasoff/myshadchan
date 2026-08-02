import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/**
 * Story 7.3 (Task 4) — "who am I" in the `account_members.id` space, the id
 * `thread_participants.member_id` is keyed on. A DIFFERENT id space from
 * `useGetIdentity().identity.id` (`members.id`, a global per-login row) —
 * `ThreadPanel.tsx`'s own Composer comment documents this exact trap for
 * message attribution; the same trap applies here for participation.
 *
 * One `["currentMemberId"]` query, mirroring `useMyContexts`'s shape
 * (`root/useMyContexts.ts`): every `ThreadPanel` mount shares the same
 * cache entry, so opening a second discussion in the same session does not
 * repeat the round trip — only the thread's OWN `thread_participants` list
 * (loaded separately, per thread) varies per panel.
 */
export const CURRENT_MEMBER_ID_QUERY_KEY = ["currentMemberId"] as const;

export const useCurrentMemberId = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: CURRENT_MEMBER_ID_QUERY_KEY,
    queryFn: () => dataProvider.getCurrentMemberId(),
  });
};

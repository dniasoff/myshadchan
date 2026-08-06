import { useMemo } from "react";
import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";

import type { ContextMember } from "../types";

export interface UseTaskAssigneesResult {
  isPending: boolean;
  /** Every active member of the caller's current context, keyed by
   * `members.id` — the same key `tasks.member_id` holds. */
  assigneesById: Map<Identifier, ContextMember>;
  assignees: ContextMember[];
  /** `> 1` active member — the chip hides itself for a null assignee in a
   * single-parent household (AC-10). */
  isMultiMember: boolean;
}

/**
 * The one `public.context_members` fetch every assignee-aware surface
 * shares (AC-3): the picker's roster and the chip's name-resolution map,
 * from a single source. Call this ONCE per surface (a list's mount point,
 * not per row) and pass the result down — react-query caches the query, but
 * every row-level chip should read the SAME resolved map rather than
 * re-deriving it.
 *
 * Never `useGetList("members")` — that table has no `account_id` and would
 * leak every household's roster into a picker scoped to one context.
 */
export const useTaskAssignees = (): UseTaskAssigneesResult => {
  const { data, isPending } = useGetList<ContextMember>("context_members", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "id", order: "ASC" },
  });

  const assignees = useMemo(() => data ?? [], [data]);
  const assigneesById = useMemo(
    () => new Map(assignees.map((member) => [member.id, member])),
    [assignees],
  );

  return {
    isPending,
    assigneesById,
    assignees,
    isMultiMember: assignees.length > 1,
  };
};

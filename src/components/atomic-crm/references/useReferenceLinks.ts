import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import type { ReferenceLinkSummary } from "../types";

/**
 * Every conversation this reference has been part of, across every shidduch in
 * the account.
 *
 * This is the query the design canvas never had: it shipped a hard-coded
 * "you've spoken to him about 2 other boys" string per mock reference. Repeat
 * recognition (FR42) has to come from reference_links or it is decoration.
 *
 * Scope note (FR51-52): deliberately NOT filtered by child. The reference book
 * is shared across every child in the account, so "other singles" means every
 * shidduch, not just this child's.
 *
 * PRV-2: account scoping is enforced by RLS, never by a client-side filter.
 */
export const useReferenceLinks = (referenceId?: Identifier) => {
  const { data, isPending, error } = useGetList<ReferenceLinkSummary>(
    "reference_links",
    {
      filter: { reference_id: referenceId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: referenceId != null },
  );

  return { links: data ?? [], isPending, error };
};

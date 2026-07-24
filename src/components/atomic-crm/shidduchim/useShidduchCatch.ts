import { useQuery } from "@tanstack/react-query";
import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ShidduchCatch } from "../types";

/**
 * Fetches the dedupe "catch" for one shidduch (E3): "you've come across this
 * person before". Read-only — it never links or merges anything; the panel that
 * consumes it lets the user confirm or dismiss. FREE by requirement: there is no
 * entitlement check anywhere on this path (mirrors match-on-entry, FR42).
 *
 * A failed catch lookup must never break the 360 view, so callers treat the
 * absence of data as "no catch" rather than an error state.
 */
export const EMPTY_CATCH: ShidduchCatch = {
  has_catch: false,
  suggestions: [],
  dates: [],
};

export const useShidduchCatch = (id?: Identifier) => {
  const dataProvider = useDataProvider<CrmDataProvider>();

  return useQuery<ShidduchCatch>({
    queryKey: ["shidduchim", String(id), "catch"],
    queryFn: () => dataProvider.catchShidduch(id as Identifier),
    enabled: id != null,
  });
};

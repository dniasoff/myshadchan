import type { RaRecord } from "ra-core";
import { useListContext } from "ra-core";

/**
 * The single, four-state list decision (AC 6) `EntityListView` (Task 2) and
 * Story 4.3's `ShidduchimViewSwitch` both consume — neither re-derives it.
 *
 * `"empty"` = no data AND no active filter value. `"no-matches"` = no data
 * AND at least one filter value is set — the search box's `q` counts as a
 * filter value like any other. `"error"` is checked before either data-
 * driven branch: a `ListContextProvider` fed `{ error, isPending: false,
 * data: [] }` must still resolve to `"error"`, never `"empty"`.
 */
export type EntityListStatus =
  | { status: "loading" }
  | { status: "error"; error: unknown; refetch: () => void }
  | { status: "empty" }
  | { status: "no-matches" }
  | { status: "ready"; data: RaRecord[] };

export function useEntityListStatus(): EntityListStatus {
  const { data, isPending, error, filterValues, refetch } = useListContext();

  if (isPending) {
    return { status: "loading" };
  }

  if (error) {
    return {
      status: "error",
      error,
      // Narrowed to `() => void`: `useListContext().refetch` may return a
      // promise (react-query's shape) — this component never awaits it, it
      // only ever triggers a retry.
      refetch: () => {
        refetch();
      },
    };
  }

  const hasData = Array.isArray(data) && data.length > 0;
  if (hasData) {
    return { status: "ready", data };
  }

  const hasActiveFilter =
    filterValues != null && Object.keys(filterValues).length > 0;
  return hasActiveFilter ? { status: "no-matches" } : { status: "empty" };
}

import type { RaRecord } from "ra-core";
import { useListContext } from "ra-core";
import isEqual from "lodash/isEqual";

/**
 * The single, four-state list decision (AC 6) `EntityListView` (Task 2) and
 * Story 4.3's `ShidduchimViewSwitch` both consume — neither re-derives it.
 *
 * `"empty"` = no data AND no active filter value BEYOND the resource's own
 * `filterDefaultValues`. `"no-matches"` = no data AND at least one filter
 * value differs from its default — the search box's `q` counts like any
 * other, since it has no default. `"error"` is checked before either data-
 * driven branch: a `ListContextProvider` fed `{ error, isPending: false,
 * data: [] }` must still resolve to `"error"`, never `"empty"`.
 *
 * `filterDefaultValues` matters because `<List filterDefaultValues={...}>`
 * seeds `filterValues` with those entries from the first render — a caller
 * with a default filter (Story 13.2's "hide archived" on `singles`) would
 * otherwise NEVER see `"empty"`, even for a viewer with zero records ever,
 * because `filterValues` is never actually `{}`. Diffed against the
 * defaults instead of checked for bare presence, so only a value the viewer
 * actually changed — including clearing a default back out — counts as
 * "active" (`ShidduchimPipelineList`'s doc comment names this same gap; that
 * caller works around it locally by bypassing this hook rather than fixing
 * it here, which is what leaves `single_id` unresolved for it either way).
 */
export type EntityListStatus =
  | { status: "loading" }
  | { status: "error"; error: unknown; refetch: () => void }
  | { status: "empty" }
  | { status: "no-matches" }
  | { status: "ready"; data: RaRecord[] };

function hasFilterBeyondDefaults(
  filterValues: Record<string, unknown> | undefined,
  filterDefaultValues: Record<string, unknown> | undefined,
): boolean {
  const values = filterValues ?? {};
  const defaults = filterDefaultValues ?? {};
  const keys = new Set([...Object.keys(values), ...Object.keys(defaults)]);
  for (const key of keys) {
    if (!isEqual(values[key], defaults[key])) {
      return true;
    }
  }
  return false;
}

export function useEntityListStatus(
  filterDefaultValues?: Record<string, unknown>,
): EntityListStatus {
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

  const hasActiveFilter = hasFilterBeyondDefaults(
    filterValues,
    filterDefaultValues,
  );
  return hasActiveFilter ? { status: "no-matches" } : { status: "empty" };
}

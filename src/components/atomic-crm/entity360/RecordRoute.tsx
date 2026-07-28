import type { ComponentType, ReactElement } from "react";
import { useEffect } from "react";
import { ShowBase } from "ra-core";
import { useParams } from "react-router";

import { RecordPending } from "./RecordPending";
import { RecordUnavailable } from "./RecordUnavailable";

/**
 * The single component instance `buildEntityRoutes` uses as the `element`
 * for BOTH record routes (`:id` and `:id/:tab`). Using one component type
 * at the same tree position for both `<Route>` entries is what lets React
 * preserve — rather than remount — it (and `ShowBase`'s already-fetched
 * record with it) across a tab click: switching between the two routes
 * only ever swaps which sibling `<Route>` matches, and React reconciles
 * the result by type at that position, not by which literal `<Route>`
 * element produced it.
 *
 * AC 2 — `ShowBase` is passed both `loading` and `error` elements: the
 * pending and record-unavailable states are explicit, and passing a
 * defined `error` element is itself what disables `useShowController`'s
 * default redirect-to-list on a fetch error.
 *
 * AC 11 — the effect resets the window scroll to `0` on mount and
 * whenever `id` (the record) changes, but never on a bare tab switch:
 * `:tab` never appears in its dependency list, and switching tabs
 * re-renders this same instance with an unchanged `id`.
 */
export function RecordRoute({ Show }: { Show: ComponentType }): ReactElement {
  const { id } = useParams<{ id?: string }>();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    <ShowBase loading={<RecordPending />} error={<RecordUnavailable />}>
      <Show />
    </ShowBase>
  );
}

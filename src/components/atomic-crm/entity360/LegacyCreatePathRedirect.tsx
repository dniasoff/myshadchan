import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router";

import { buildNewPath } from "./entityPaths";

/**
 * Split out of `routeConvention.tsx` (Story 3.12 Dev Notes: "if it grows
 * past that [ceiling], split the legacy redirect into its own module rather
 * than appending") — also what keeps `routeConvention.tsx` a pure-function
 * module, so `react-refresh/only-export-components` does not warn on a file
 * mixing a component export with plain functions.
 *
 * The permanent `/{entity}/create` -> `/{entity}/new` redirect (AC 1), query
 * string intact: `references/ReferenceCreate.tsx` reads `shidduchim_id` and
 * `shidduchim/ShidduchCreate.tsx` reads `state` from it, so a redirect that
 * dropped the search would silently break both prefill flows.
 */
export function LegacyCreatePathRedirect({
  name,
}: {
  name: string;
}): ReactElement {
  const location = useLocation();
  return (
    <Navigate
      replace
      to={{ pathname: buildNewPath(name), search: location.search }}
    />
  );
}

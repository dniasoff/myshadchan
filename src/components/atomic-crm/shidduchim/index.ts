import "./entityDescriptor";

import React from "react";

import { buildCreateRoutes } from "../entity360/routeConvention";

const ShidduchimList = React.lazy(() => import("./ShidduchimList"));

/**
 * No `New` here: the create surface is a page matched inside
 * `ShidduchimList` itself (Story 3.13 —
 * `ShidduchimList.tsx`'s `matchPath(buildNewPath("shidduchim"), …)`), not a
 * routed component — `buildCreateRoutes` supplies only the `/create` ->
 * `/new` compatibility redirect (contract §5 scope boundary).
 */
export default {
  list: ShidduchimList,
  children: buildCreateRoutes("shidduchim"),
};

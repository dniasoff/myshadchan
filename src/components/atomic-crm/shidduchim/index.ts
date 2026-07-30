import "./entityDescriptor";

import React from "react";

import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
import { buildCreateRoutes } from "../entity360/routeConvention";
import { ShidduchCreatePage } from "./ShidduchCreatePage";

const ShidduchimList = React.lazy(() => import("./ShidduchimList"));

/**
 * Story 5.1 — the pilot AD-24 migration (contract §5 rule 4; this story's
 * own five-edit table). `list` is now `buildEntityRoutes`'s return value —
 * a real routed `Show` (`EntityShow`), not the old routed `<Dialog>` — and
 * `New` moves INSIDE it. `hasShow: true` is explicit and required:
 * `Resource.registerResource` computes `hasShow: !!show || !!hasShow`
 * (`ra-core/dist/core/Resource.js:33-34`), and `list` alone leaves it
 * `false`. No `hasEdit` — `shidduchim` has no `ShidduchEdit`.
 *
 * **The one part of this shape 5.8/5.9/5.10 must NOT copy blindly:** moving
 * `New` here and dropping the second `buildCreateRoutes` argument is
 * correct ONLY because `shidduchim` is the sole entity whose create surface
 * used to be matched inside its own list (Story 3.13), not routed through
 * `buildCreateRoutes`. `singles`/`shadchanim`/`references` already pass
 * `New` to `buildCreateRoutes` and must keep doing so — declaring `New` in
 * both places at once would register `/{entity}/new` twice.
 */
export default {
  list: buildEntityRoutes({
    List: ShidduchimList,
    New: ShidduchCreatePage,
    Show: EntityShow,
  }),
  hasShow: true,
  children: buildCreateRoutes("shidduchim"), // the /create -> /new redirect only
};

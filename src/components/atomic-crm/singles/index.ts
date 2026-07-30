import "./entityDescriptor";

import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Single } from "../types";
import { SingleCreate } from "./SingleCreate";
import { SingleEdit } from "./SingleEdit";
import { SingleList } from "./SingleList";

/**
 * Story 5.8 — the AD-24 migration (contract §5 rule 4). `list` is now
 * `buildEntityRoutes`'s return value — a real routed `Show` (`EntityShow`),
 * not the old routed `<Dialog>`-free `<Show>` page — with explicit
 * `hasShow: true` and `hasEdit: true`: `Resource.registerResource` computes
 * `hasShow: !!show || !!hasShow` / `hasEdit: !!edit || !!hasEdit`
 * (`ra-core/dist/core/Resource.js:32-34`), so dropping this entity's own
 * `show:`/`edit:` props without the two explicit flags would leave both
 * `false` and every `<DataTable>` row unclickable.
 *
 * `New` is NOT passed to `buildEntityRoutes` here — unlike `shidduchim`
 * (Story 5.1's one-time exception), `singles` keeps its create surface
 * routed the way `buildCreateRoutes` already provides it: `hasCreate: true`
 * keeps `<List>`'s built-in `CreateButton` rendering, and
 * `children: buildCreateRoutes("singles", SingleCreate)` supplies the
 * `new/*` route plus the `/create` -> `/new` compatibility redirect
 * (contract §5 scope boundary).
 */
export default {
  list: buildEntityRoutes({
    List: SingleList,
    Edit: SingleEdit,
    Show: EntityShow,
  }),
  hasShow: true,
  hasEdit: true,
  hasCreate: true,
  children: buildCreateRoutes("singles", SingleCreate),
  recordRepresentation: (record: Single) =>
    [record.first_name_en, record.last_name_en].filter(Boolean).join(" ") ||
    `Single #${record.id}`,
};

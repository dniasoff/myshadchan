import "./entityDescriptor";

import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Shadchan } from "../types";
import { ShadchanCreate } from "./ShadchanCreate";
import { ShadchanEdit } from "./ShadchanEdit";
import { ShadchanList } from "./ShadchanList";

/**
 * Story 5.9 — the AD-24 migration (contract §5 rule 4). `list` is now
 * `buildEntityRoutes`'s return value — a real routed `Show` (`EntityShow`),
 * not the old un-tabbed `<Show>` page — with explicit `hasShow: true` and
 * `hasEdit: true`: `Resource.registerResource` computes
 * `hasShow: !!show || !!hasShow` / `hasEdit: !!edit || !!hasEdit`
 * (`ra-core/dist/core/Resource.js:32-34`), so dropping this entity's own
 * `show:`/`edit:` props without the two explicit flags would leave both
 * `false` and every `<DataTable>` row on the shadchanim list unclickable.
 *
 * `New` is NOT passed to `buildEntityRoutes` here — `shadchanim` keeps its
 * create surface routed the way `buildCreateRoutes` already provides it:
 * `hasCreate: true` keeps `<List>`'s built-in `CreateButton` rendering, and
 * `children: buildCreateRoutes("shadchanim", ShadchanCreate)` supplies the
 * `new/*` route plus the `/create` -> `/new` compatibility redirect
 * (contract §5 scope boundary). 5.1/5.8 do the opposite (move `New` inside
 * `buildEntityRoutes`); doing both here would declare `/shadchanim/new`
 * twice.
 */
export default {
  list: buildEntityRoutes({
    List: ShadchanList,
    Edit: ShadchanEdit,
    Show: EntityShow,
  }),
  hasShow: true,
  hasEdit: true,
  hasCreate: true,
  children: buildCreateRoutes("shadchanim", ShadchanCreate),
  recordRepresentation: (record: Shadchan) => record.name,
};

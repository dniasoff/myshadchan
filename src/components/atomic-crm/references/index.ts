import "./entityDescriptor";

import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Reference } from "../types";
import { ReferenceCreate } from "./ReferenceCreate";
import { ReferenceEdit } from "./ReferenceEdit";
import { ReferencesIndex } from "./ReferencesIndex";

/**
 * Story 5.10 — the AD-24 migration (contract §5 rule 4). `list` is now
 * `buildEntityRoutes`'s return value — a real routed `Show` (`EntityShow`),
 * not the old un-tabbed `<Show>` page — with explicit `hasShow: true` and
 * `hasEdit: true`: `Resource.registerResource` computes
 * `hasShow: !!show || !!hasShow` / `hasEdit: !!edit || !!hasEdit`
 * (`ra-core/dist/core/Resource.js:32-34`), so dropping this entity's own
 * `show:`/`edit:` props without the two explicit flags would leave both
 * `false` and every inferred record link (including `RecordLink`) stop
 * resolving (`entity360/buildEntityRoutes.tsx:43-54`).
 *
 * `list` is still the ROUTE MOUNT, not "the list page" (RULING 7 / the
 * references-scoping plan §1a) — `buildEntityRoutes` puts `index`, `new`,
 * `:id/edit`, `:id` and `:id/:tab` inside one `<Routes>`, so dropping `list`
 * would delete `/references/:id` along with the unattached-references panel.
 * `ReferencesIndex` (RULING 7's unattached panel, Task 6) is the `List`;
 * `references` never registers a browsable reference book.
 *
 * `New` is NOT passed to `buildEntityRoutes` here — `references` keeps its
 * create surface routed the way `buildCreateRoutes` already provides it:
 * `hasCreate: true` plus `children: buildCreateRoutes("references",
 * ReferenceCreate)` supplies the `new/*` route plus the `/create` -> `/new`
 * compatibility redirect (contract §5 scope boundary). 5.1/5.8 do the
 * opposite (move `New` inside `buildEntityRoutes`); doing both here would
 * declare `/references/new` twice.
 */
export default {
  list: buildEntityRoutes({
    List: ReferencesIndex,
    Edit: ReferenceEdit,
    Show: EntityShow,
  }),
  hasShow: true,
  hasEdit: true,
  hasCreate: true,
  children: buildCreateRoutes("references", ReferenceCreate),
  recordRepresentation: (record: Reference) =>
    record.name_en || String(record.id),
};

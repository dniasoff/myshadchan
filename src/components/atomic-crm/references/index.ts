import "./entityDescriptor";

import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Reference } from "../types";
import { ReferenceCreate } from "./ReferenceCreate";
import { ReferenceEdit } from "./ReferenceEdit";
import { ReferencesIndex } from "./ReferencesIndex";
import { ReferenceShow } from "./ReferenceShow";

/**
 * Creation lives at `new` (AD-24 / Story 3.12), not `<Resource>`'s own
 * `create` prop: `children: buildCreateRoutes(...)` supplies the `new/*`
 * route plus the `/create` -> `/new` compatibility redirect (contract §5
 * scope boundary). `hasCreate: true` stays because the create route really
 * does exist — it no longer renders a `CreateButton` anywhere, since
 * `admin/list.tsx` is the only consumer of the flag and `references` no
 * longer registers a `<List>` at all.
 *
 * `list` is the ROUTE MOUNT, not "the list page" (RULING 7 / the
 * references-scoping plan §1a). `entity360/buildEntityRoutes.tsx` types
 * `List` as required and the element passed to `<Resource list={…}>` is what
 * mounts `/references/:id`; dropping the prop would delete the record route
 * along with the book, and `/references` would render `null` inside the app
 * shell rather than 404. So the slot is kept and the COMPONENT is what
 * changed: `ReferencesIndex` (unattached references only, each with an
 * attach action), never a browsable reference book.
 */
export default {
  list: ReferencesIndex,
  show: ReferenceShow,
  edit: ReferenceEdit,
  hasCreate: true,
  children: buildCreateRoutes("references", ReferenceCreate),
  recordRepresentation: (record: Reference) =>
    record.name_en || String(record.id),
};

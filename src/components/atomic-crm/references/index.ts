import "./entityDescriptor";

import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Reference } from "../types";
import { ReferenceCreate } from "./ReferenceCreate";
import { ReferenceEdit } from "./ReferenceEdit";
import { ReferenceList } from "./ReferenceList";
import { ReferenceShow } from "./ReferenceShow";

/**
 * Creation lives at `new` (AD-24 / Story 3.12), not `<Resource>`'s own
 * `create` prop: `hasCreate: true` keeps `<List>`'s built-in `CreateButton`
 * (`admin/list.tsx:152`) rendering, and `children: buildCreateRoutes(...)`
 * supplies the `new/*` route plus the `/create` -> `/new` compatibility
 * redirect (contract §5 scope boundary).
 */
export default {
  list: ReferenceList,
  show: ReferenceShow,
  edit: ReferenceEdit,
  hasCreate: true,
  children: buildCreateRoutes("references", ReferenceCreate),
  recordRepresentation: (record: Reference) =>
    record.name_en || String(record.id),
};

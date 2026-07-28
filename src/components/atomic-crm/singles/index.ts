import "./entityDescriptor";

import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Single } from "../types";
import { SingleCreate } from "./SingleCreate";
import { SingleEdit } from "./SingleEdit";
import { SingleList } from "./SingleList";
import { SingleShow } from "./SingleShow";

/**
 * Creation lives at `new` (AD-24 / Story 3.12), not `<Resource>`'s own
 * `create` prop: `hasCreate: true` keeps `<List>`'s built-in `CreateButton`
 * (`admin/list.tsx:152`) rendering, and `children: buildCreateRoutes(...)`
 * supplies the `new/*` route plus the `/create` -> `/new` compatibility
 * redirect (contract §5 scope boundary).
 */
export default {
  list: SingleList,
  edit: SingleEdit,
  show: SingleShow,
  hasCreate: true,
  children: buildCreateRoutes("singles", SingleCreate),
  recordRepresentation: (record: Single) =>
    [record.first_name_en, record.last_name_en].filter(Boolean).join(" ") ||
    `Single #${record.id}`,
};

import "./entityDescriptor";

import { buildCreateRoutes } from "../entity360/routeConvention";
import type { Shadchan } from "../types";
import { ShadchanCreate } from "./ShadchanCreate";
import { ShadchanEdit } from "./ShadchanEdit";
import { ShadchanList } from "./ShadchanList";
import { ShadchanShow } from "./ShadchanShow";

/**
 * Creation lives at `new` (AD-24 / Story 3.12), not `<Resource>`'s own
 * `create` prop: `hasCreate: true` keeps `<List>`'s built-in `CreateButton`
 * (`admin/list.tsx:152`) rendering, and `children: buildCreateRoutes(...)`
 * supplies the `new/*` route plus the `/create` -> `/new` compatibility
 * redirect (contract §5 scope boundary).
 */
export default {
  list: ShadchanList,
  edit: ShadchanEdit,
  show: ShadchanShow,
  hasCreate: true,
  children: buildCreateRoutes("shadchanim", ShadchanCreate),
  recordRepresentation: (record: Shadchan) => record.name,
};

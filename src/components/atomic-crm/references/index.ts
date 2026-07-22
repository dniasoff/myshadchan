import type { Reference } from "../types";
import { ReferenceCreate } from "./ReferenceCreate";
import { ReferenceEdit } from "./ReferenceEdit";
import { ReferenceList } from "./ReferenceList";
import { ReferenceShow } from "./ReferenceShow";

export default {
  list: ReferenceList,
  show: ReferenceShow,
  create: ReferenceCreate,
  edit: ReferenceEdit,
  recordRepresentation: (record: Reference) =>
    record.name_en || record.name_he || String(record.id),
};

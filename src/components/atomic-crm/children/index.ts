import type { Child } from "../types";
import { ChildCreate } from "./ChildCreate";
import { ChildEdit } from "./ChildEdit";
import { ChildList } from "./ChildList";

export default {
  list: ChildList,
  create: ChildCreate,
  edit: ChildEdit,
  recordRepresentation: (record: Child) =>
    [record.first_name_en, record.last_name_en].filter(Boolean).join(" ") ||
    record.first_name_he ||
    `Child #${record.id}`,
};

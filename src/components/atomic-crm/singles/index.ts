import type { Single } from "../types";
import { SingleCreate } from "./SingleCreate";
import { SingleEdit } from "./SingleEdit";
import { SingleList } from "./SingleList";
import { SingleShow } from "./SingleShow";

export default {
  list: SingleList,
  create: SingleCreate,
  edit: SingleEdit,
  show: SingleShow,
  recordRepresentation: (record: Single) =>
    [record.first_name_en, record.last_name_en].filter(Boolean).join(" ") ||
    `Single #${record.id}`,
};

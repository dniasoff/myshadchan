import type { Shadchan } from "../types";
import { ShadchanCreate } from "./ShadchanCreate";
import { ShadchanEdit } from "./ShadchanEdit";
import { ShadchanList } from "./ShadchanList";
import { ShadchanShow } from "./ShadchanShow";

export default {
  list: ShadchanList,
  create: ShadchanCreate,
  edit: ShadchanEdit,
  show: ShadchanShow,
  recordRepresentation: (record: Shadchan) => record.name,
};

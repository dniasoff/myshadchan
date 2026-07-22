import type { Shadchan } from "../types";
import { ShadchanCreate } from "./ShadchanCreate";
import { ShadchanEdit } from "./ShadchanEdit";
import { ShadchanList } from "./ShadchanList";

export default {
  list: ShadchanList,
  create: ShadchanCreate,
  edit: ShadchanEdit,
  recordRepresentation: (record: Shadchan) => record.name,
};

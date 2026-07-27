import type { Member } from "../types";
import { MemberCreate } from "./MemberCreate";
import { MemberEdit } from "./MemberEdit";
import { MemberList } from "./MemberList";

export default {
  list: MemberList,
  create: MemberCreate,
  edit: MemberEdit,
  recordRepresentation: (record: Member) =>
    `${record.first_name} ${record.last_name}`,
};

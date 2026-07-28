import type { Member } from "../types";
import { MemberEdit } from "./MemberEdit";
import { MemberList } from "./MemberList";

export default {
  list: MemberList,
  edit: MemberEdit,
  recordRepresentation: (record: Member) =>
    `${record.first_name} ${record.last_name}`,
};

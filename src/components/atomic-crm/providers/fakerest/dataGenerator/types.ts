import type {
  Account,
  AccountMember,
  Child,
  ChildPortalToken,
  DateRecord,
  InboxItem,
  Interaction,
  PipelineTransition,
  Redt,
  Reference,
  ReferenceLink,
  Resume,
  Sale,
  Shadchan,
  Shidduch,
  ShidduchSchool,
  Task,
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";

export interface Db {
  sales: Sale[];
  tasks: Task[];
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
  // Shidduchim pipeline domain
  accounts: Account[];
  account_members: AccountMember[];
  children: Child[];
  shadchanim: Shadchan[];
  references: Reference[];
  shidduchim: Shidduch[];
  resumes: Resume[];
  reference_links: ReferenceLink[];
  date_records: DateRecord[];
  redts: Redt[];
  shidduch_schools: ShidduchSchool[];
  pipeline_transitions: PipelineTransition[];
  interactions: Interaction[];
  inbox_items: InboxItem[];
  child_portal_tokens: ChildPortalToken[];
}

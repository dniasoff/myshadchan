import type {
  Account,
  AccountMember,
  Child,
  ChildPortalToken,
  Company,
  Contact,
  ContactNote,
  DateRecord,
  Deal,
  DealNote,
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
  Tag,
  Task,
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";

export interface Db {
  companies: Company[];
  contacts: Contact[];
  contact_notes: ContactNote[];
  deals: Deal[];
  deal_notes: DealNote[];
  sales: Sale[];
  tags: Tag[];
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

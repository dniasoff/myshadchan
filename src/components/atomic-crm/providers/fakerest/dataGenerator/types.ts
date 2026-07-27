import type {
  Account,
  AccountMember,
  DateRecord,
  InboxItem,
  Interaction,
  Member,
  PipelineTransition,
  Redt,
  Reference,
  ReferenceLink,
  Resume,
  Shadchan,
  Shidduch,
  ShidduchSchool,
  Single,
  Task,
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";

export interface Db {
  members: Member[];
  tasks: Task[];
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
  // Shidduchim pipeline domain
  accounts: Account[];
  account_members: AccountMember[];
  singles: Single[];
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
}

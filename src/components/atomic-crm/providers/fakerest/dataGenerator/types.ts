import type {
  Account,
  AccountMember,
  DateRecord,
  EntityFile,
  InboxItem,
  Interaction,
  Invite,
  MedicalNote,
  Member,
  PipelineTransition,
  Redt,
  Reference,
  ReferenceLink,
  Resume,
  ResumePhoto,
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
  // Photo tab (Story 5.4) — seeded empty, matching entity_files below: the
  // demo build must not crash on this tab. Written only through
  // uploadResumePhoto()/hideResumePhoto() (never a raw dataProvider.create/
  // update).
  resume_photos: ResumePhoto[];
  // Medical tab (Story 5.5) — seeded empty, matching resume_photos/entity_files
  // above: the demo build must not crash on this tab. Plain CRUD through
  // dataProvider.create/getList (no custom method — unlike resume_photos'
  // uploadResumePhoto()/hideResumePhoto(), a medical note has no storage
  // object or soft-hide to broker).
  medical_notes: MedicalNote[];
  reference_links: ReferenceLink[];
  date_records: DateRecord[];
  redts: Redt[];
  shidduch_schools: ShidduchSchool[];
  pipeline_transitions: PipelineTransition[];
  interactions: Interaction[];
  // Files tab (Story 3.7) — seeded empty; the demo build must not crash on
  // this tab. Written only through uploadEntityFile()/deleteEntityFile()
  // (never a raw dataProvider.create/update), same as invites below.
  entity_files: EntityFile[];
  inbox_items: InboxItem[];
  // Invites as the one membership mechanism (Story 2.8) — the inviter-side
  // UI's own collection; seeded empty, written only through
  // createInvite()/revokeInvite() (never a raw dataProvider.create/update).
  invites: Invite[];
}

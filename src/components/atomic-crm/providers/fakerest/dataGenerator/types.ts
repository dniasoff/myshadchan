import type {
  Account,
  AccountMember,
  Connection,
  ConnectionInvite,
  DateRecord,
  EntityFile,
  InboxItem,
  Interaction,
  Invite,
  Listing,
  ListingWithdrawalLock,
  MedicalNote,
  Member,
  Message,
  PipelineTransition,
  Redt,
  Reference,
  ReferenceLink,
  Resume,
  ResumePhoto,
  Shadchan,
  Shidduch,
  ShidduchExternalLink,
  ShidduchSchool,
  Single,
  Task,
  Thread,
  ThreadParticipant,
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
  // External links tab (Story 5.6) — seeded empty, same reasoning as
  // medical_notes above: the demo build must not crash on this tab. Plain
  // CRUD through dataProvider.create/getList/delete (no custom method).
  shidduchim_external_links: ShidduchExternalLink[];
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
  // Communication (Story 7.1) — seeded empty; the demo build must not crash
  // on the Discussions tab. `threads`/`thread_participants` are written only
  // through createThread() (never a raw dataProvider.create), mirroring
  // create_thread() being the sole DB creation path; `messages` is plain
  // CRUD through dataProvider.create/getList (no custom method — a message
  // has no storage object or soft-hide to broker). `connections` has NO
  // client write path at all (AC-6), matching invites/entity_files above.
  connections: Connection[];
  // Story 8.2 — seeded empty; every real row is written only through
  // createConnectionInvite()/revokeConnectionInvite() (never a raw
  // dataProvider.create/update), same as invites above.
  connection_invites: ConnectionInvite[];
  threads: Thread[];
  thread_participants: ThreadParticipant[];
  messages: Message[];
  // Story 9.1 — seeded empty; the demo build must not crash on the
  // "Publish my listing" settings panel. Written only through
  // PublishShadchanListingSection.tsx's own create/update calls and
  // WithdrawShadchanListingButton.tsx's delete (never seeded with a
  // pre-published row, matching the "opt-in, nothing published by default"
  // requirement AC-1 makes for the real database too).
  listings: Listing[];
  // Story 9.3 — seeded empty; the only writers are the hand-emulated
  // withdrawal-lock trigger (lockListingOnSingleWithdrawal(), called from
  // the "listings" delete handler) and the consent_to_republish_listing()
  // mirror's own delete. Never seeded with a pre-existing lock, matching
  // "opt-in, nothing locked by default" the same way `listings` itself is.
  listing_withdrawal_locks: ListingWithdrawalLock[];
}

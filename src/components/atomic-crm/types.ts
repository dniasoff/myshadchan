import type { Identifier, RaRecord } from "ra-core";

/**
 * The five fields `get_invite_preview()` (02_functions.sql) returns to an
 * UNAUTHENTICATED invitee previewing their invite at /accept-invite/:token
 * (Story 2.7, AC-4) — never the inviting account's own data, `invited_by`,
 * `id` or the token itself. `status` is the server-computed EFFECTIVE
 * status: a `pending` row past its `expires_at` reports as `expired`.
 */
export type InvitePreview = {
  email: string;
  account_name: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
};

/**
 * One row of `public.invites` (Story 2.7's table, Story 2.8's inviter-side
 * UI — `InvitesSection.tsx`). `role` is `InvitableRole`, not the broader
 * `MemberRole`: the table's own `invites_role_check` constraint
 * (01_tables.sql) permits every `MemberRole` except `self_manager`.
 *
 * `target_single_id` (Story 6.1): the `singles` row a `role = 'single'`
 * invite links at acceptance — always set for that role, always null for
 * every other (the table's own `invites_role_target_check`).
 */
export type Invite = {
  token: string;
  email: string;
  account_id: Identifier;
  role: InvitableRole;
  invited_by?: Identifier | null;
  target_single_id?: Identifier | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  accepted_at?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

export type MemberFormData = {
  avatar?: string;
  email: string;
  first_name: string;
  last_name: string;
  administrator: boolean;
  disabled: boolean;
};

export type Member = {
  first_name: string;
  last_name: string;
  administrator: boolean;
  avatar?: RAFile;
  disabled?: boolean;
  user_id: string;

  /**
   * This is a copy of the user's email, to make it easier to handle by react admin
   * DO NOT UPDATE this field directly, it should be updated by the backend
   */
  email: string;

  /**
   * This is used by the fake rest provider to store the password
   * DO NOT USE this field in your code besides the fake rest provider
   * @deprecated
   */
  password?: string;
} & Pick<RaRecord, "id">;

/**
 * The one target-type vocabulary for every polymorphic entity link in the app
 * (AD-13, entity360 contract §8) — tasks, interactions and (Story 3.7)
 * `entity_files` all point at one of these four. `single` runs ahead of the
 * database on purpose: `tasks_target_type_check` and
 * `interactions_target_type_check` (`supabase/schemas/01_tables.sql`) do not
 * accept it yet — see `entity360/pendingDbWidenings.ts` for the tracked gap.
 * Widening this union is safe today because nothing writes a
 * single-targeted task or interaction until Story 3.8 / 3.5 land (3.9 keeps
 * `single` out of `reminders/reminderEntity.ts`'s `LINKABLE_TARGET_TYPES`,
 * the only picker that writes one).
 */
export const ENTITY_TARGET_TYPES = [
  "shidduch",
  "single",
  "shadchan",
  "reference",
] as const;

export type EntityTargetType = (typeof ENTITY_TARGET_TYPES)[number];

/**
 * Tasks/reminders. Polymorphic (AD-13) so a reminder can hang off a shadchan,
 * a shidduch, a single or a reference without a parallel table per entity
 * (FR44-46). Widened in place to alias `EntityTargetType` — never
 * re-declared as a second, independent union alongside it.
 */
export type TaskTargetType = EntityTargetType;

/** Delivery is in-app + email (primary) + push. There is deliberately no SMS. */
export type TaskDeliveryChannel = "in_app" | "email" | "push";

export type Task = {
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  member_id?: Identifier;
  account_id?: Identifier;
  target_type?: TaskTargetType;
  target_id?: Identifier;
  delivery_channels?: TaskDeliveryChannel[];
} & Pick<RaRecord, "id">;

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export interface LabeledValue {
  value: string;
  label: string;
}

// =====================================================================
// MyShadchan — Shidduchim pipeline domain (AD-4, AD-12)
// =====================================================================

/** The one canonical pipeline state (AD-4): exactly 7 values, no substate. */
export type PipelineState =
  "new" | "look_into" | "not_sure" | "for_sure_not" | "yes" | "unsure" | "no";

export type MemberRole =
  "parent_admin" | "helper" | "self_manager" | "shadchan" | "single";

/** The `MemberRole` values `invites.role`'s check constraint permits
 * (01_tables.sql, Story 2.7) — every `MemberRole` except `self_manager`,
 * which is a role a person ARRIVES at (`add_persona('single')` finding no
 * existing household), never one a second person is invited into
 * (`create_invite()`'s own comment, 02_functions.sql). */
export type InvitableRole = Exclude<MemberRole, "self_manager">;

export type ShidduchOrigin = "channel" | "manual" | "shadchan";

export type ShidduchVisibility = "shared" | "private_parent" | "private_single";

/**
 * `entity_files.visibility` (Story 3.7) — the SAME AD-3 vocabulary
 * `ShidduchVisibility` carries, not a second one: `epics.md`'s per-file
 * visibility AC uses the domain's existing three values. Widened in place to
 * alias it — never re-declared as an independent union alongside it,
 * mirroring how `TaskTargetType` aliases `EntityTargetType` below.
 */
export type EntityFileVisibility = ShidduchVisibility;

export type Account = {
  name: string;
  transparency_level: string;
  data_region?: string | null;
  /** Household vs. shadchanus (2.2 AC-1). `not null default 'household'` in
   * `01_tables.sql`, backfilled by 2.2's migration — every row in the tree
   * has one. */
  kind: "household" | "shadchanus";
  /** Story 7.2 (AC-1, AC-2): the household's own default for a new thread's
   * `visibility` when `create_thread()` is called without an explicit
   * `p_visibility` (AD-22; FR96/FR99) — `not null default 'open'` in
   * `01_tables.sql`, backfilled for every pre-existing row by the same
   * migration. A genuinely new field, not a reuse of `transparency_level`
   * above (see that story's Dev Notes, "Do not reuse transparency_level"). */
  default_thread_visibility: ThreadVisibility;
  created_at: string;
  demo?: boolean;
} & Pick<RaRecord, "id">;

export type AccountMember = {
  account_id: Identifier;
  user_id?: string | null;
  role: MemberRole;
  status: string;
  invited_by?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** A persona a login may hold (personas-and-contexts.md) — the one the
 * onboarding multi-select ticks and `add_persona()` provisions. Not every
 * `MemberRole` is a persona: `helper` never is. */
export type Persona = "single" | "parent" | "shadchan";

/** One row of `public.my_personas()`'s return shape (2.2 AC-8) — "what am I,
 * and in which context." `role` is the underlying `account_members.role`
 * that earned this persona (e.g. `single` is reported for both a `single`
 * membership and an owning `parent_admin`/`self_manager` one that has a
 * `singles` row pointing at it). */
export type MyPersona = {
  persona: Persona;
  account_id: Identifier;
  account_kind: "household" | "shadchanus";
  role: MemberRole;
};

/** One row of `public.my_contexts()`'s return shape (2.4 AC-5) — "which
 * context can I switch to, and is it the one I'm in now." One row per
 * account regardless of how many personas the caller holds within it —
 * contrast `MyPersona`, which is deliberately persona-shaped instead. */
export type MyContext = {
  account_id: Identifier;
  kind: "household" | "shadchanus";
  name: string;
  role: MemberRole;
  is_active: boolean;
};

export type Single = {
  account_id: Identifier;
  first_name_en?: string | null;
  first_name_he?: string | null;
  last_name_en?: string | null;
  last_name_he?: string | null;
  gender?: string | null;
  dob?: string | null;
  community?: string | null;
  status: string;
  member_id?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * singles_summary — per-single pipeline counts (E6). Every Single field plus a
 * total suggestion count and an "open" (still-in-triage) count, so the roster
 * card shows "N in pipeline" without an N+1 fetch.
 */
export type SingleSummary = Single & {
  total_shidduchim: number;
  open_shidduchim: number;
};

export type Shadchan = {
  account_id: Identifier;
  name: string;
  name_he?: string | null;
  location?: string | null;
  contacts?: unknown;
  responsiveness?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * shadchan_stats — per-shadchan productivity counts (E5). Keyed on the
 * shadchan's id. Mirrors the "Suggestions from this shadchan" list, which
 * filters shidduchim by shadchan_id, so the tiles agree with the list.
 * A "led to dates" metric is intentionally absent: date_records carries no
 * shadchan linkage, so there is no honest field to count.
 *
 * `last_redt_date`/`nb_open_singles` (Story 5.9, RULING 8) feed the shadchan
 * 360's Overview tab: the most recent redt among shidduchim currently
 * attributed to this shadchan (null iff there are none), and the count of
 * distinct singles among those shidduchim still in an open pipeline state.
 */
export type ShadchanStats = {
  account_id: Identifier;
  nb_suggestions: number;
  nb_progressed: number;
  nb_reached_yes: number;
  last_redt_date: string | null;
  nb_open_singles: number;
} & Pick<RaRecord, "id">;

export type Reference = {
  account_id: Identifier;
  name_en?: string | null;
  name_he?: string | null;
  relationship?: string | null;
  phone?: string | null;
  school?: string | null;
  grad_year?: number | null;
  created_at: string;
  /**
   * Match keys, set by the database's normalize trigger. Read-only to the SPA:
   * the client never normalizes and never writes these (AD-5).
   */
  name_norm_en?: string | null;
  name_norm_he?: string | null;
  phone_norm?: string | null;
} & Pick<RaRecord, "id">;

/** references_summary — the reference book's list read path (AD-10). */
export type ReferenceSummary = Reference & {
  linked_shidduchim_count: number;
  contacted_count: number;
  last_conversation_at?: string | null;
  open_task_count: number;
};

/** The central object (AD-4): one single, one canonical pipeline_state. */
export type Shidduch = {
  account_id: Identifier;
  single_id: Identifier;
  shadchan_id?: Identifier | null;
  name_en?: string | null;
  name_he?: string | null;
  father_en?: string | null;
  father_he?: string | null;
  mother_en?: string | null;
  mother_he?: string | null;
  seminary_en?: string | null;
  seminary_he?: string | null;
  shul_en?: string | null;
  shul_he?: string | null;
  location_en?: string | null;
  location_he?: string | null;
  age?: number | null;
  height?: string | null;
  dob?: string | null;
  background?: string | null;
  marital_status?: string | null;
  existing_children_note?: string | null;
  pipeline_state: PipelineState;
  first_suggested_by?: Identifier | null;
  first_suggested_at: string;
  redt_date: string;
  close_reason?: string | null;
  origin: ShidduchOrigin;
  owner_member_id?: Identifier | null;
  visibility: ShidduchVisibility;
  index: number;
  created_at: string;
} & Pick<RaRecord, "id">;

/** Row shape returned by the shidduchim_summary view (board read path, AD-10). */
export type ShidduchSummary = Shidduch & {
  shadchan_name?: string | null;
  shadchan_name_he?: string | null;
  single_first_name_en?: string | null;
  single_first_name_he?: string | null;
  single_last_name_en?: string | null;
  single_last_name_he?: string | null;
  nb_references?: number;
  nb_redts?: number;
  /**
   * Dedupe "catch" count (E3): how many OTHER suggestions in this account look
   * like the same person. Drives the board card's calm "Suggested before" chip.
   * Comes from shidduchim_summary.catch_count, so no per-card N+1 lookup.
   */
  catch_count?: number;
};

/**
 * A redt event: a shidduch can be redt many times, by the same shadchan or
 * different ones, on different dates. shidduchim.redt_date reflects the latest.
 */
export type Redt = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  shadchan_id?: Identifier | null;
  redt_date: string;
  note?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** Input accepted by addRedt() — mirrors the add_redt RPC. */
export type AddRedtInput = {
  shidduchim_id: Identifier;
  shadchan_id?: Identifier | null;
  redt_date?: string | null;
  note?: string | null;
};

export type SchoolKind =
  "seminary" | "yeshiva" | "school" | "college" | "other";

/**
 * A school/seminary/yeshiva a single attended. A shidduch can have several
 * (seminaries for a girl, yeshivas for a boy, plus schools), each with optional
 * years.
 */
export type ShidduchSchool = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  kind: SchoolKind;
  name_en?: string | null;
  name_he?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** Input accepted by addSchool() — mirrors the add_school RPC. */
export type AddSchoolInput = {
  shidduchim_id: Identifier;
  kind?: SchoolKind;
  name_en?: string | null;
  name_he?: string | null;
  start_year?: number | null;
  end_year?: number | null;
};

/**
 * Story 5.6 — a bookmark to an external profile (a shidduch site, a social
 * profile) with no file behind it. Shidduch-scoped only, deliberately not
 * polymorphic (YAGNI) — see `shidduchim/ExternalLinksTab.tsx`.
 */
export type ShidduchExternalLink = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  url: string;
  label?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** Input accepted by createShidduch() — mirrors the create_shidduch RPC (AD-4). */
export type CreateShidduchInput = {
  single_id: Identifier;
  shadchan_id?: Identifier | null;
  name_en?: string | null;
  name_he?: string | null;
  father_en?: string | null;
  father_he?: string | null;
  mother_en?: string | null;
  mother_he?: string | null;
  seminary_en?: string | null;
  seminary_he?: string | null;
  shul_en?: string | null;
  shul_he?: string | null;
  location_en?: string | null;
  location_he?: string | null;
  age?: number | null;
  height?: string | null;
  dob?: string | null;
  background?: string | null;
  marital_status?: string | null;
  existing_children_note?: string | null;
  origin?: ShidduchOrigin;
  initial_state?: PipelineState;
  visibility?: ShidduchVisibility;
  redt_date?: string | null;
};

/** Where a captured inbox item arrived from (Epic 2 capture funnel). */
export type InboxSource = "whatsapp" | "sms" | "email" | "photo" | "upload";
/** Triage state of a captured item: needs confirmation, resolved, or dismissed. */
export type InboxStatus = "unresolved" | "resolved" | "dismissed";

/**
 * An un-triaged capture in the inbox "front door" (Epic 2). Arrives by PWA
 * share, inbound email, or manual upload and is stored verbatim until one calm
 * resolve step (which single / which shadchan) turns it into a shidduch.
 */
export type InboxItem = {
  id: Identifier;
  account_id?: Identifier;
  created_at: string;
  source: InboxSource;
  raw_text?: string | null;
  subject?: string | null;
  sender?: string | null;
  attachments?: unknown[] | null;
  status: InboxStatus;
  single_id?: Identifier | null;
  shadchan_id?: Identifier | null;
  resolved_shidduchim_id?: Identifier | null;
};

/**
 * One entry in `Resume.files` (Story 5.3, AC 2). Written ONLY by
 * `add_resume_file()` — the SPA never PATCHes `resumes.files` wholesale,
 * because a client read-modify-write would race under concurrent uploads.
 * `uploaded_by` is a `members.id` (never resolved to a name here — there is
 * no `resumes_summary` view; Task 4 does not need one).
 */
export type ResumeFileVersion = {
  path: string;
  filename: string;
  uploaded_at: string;
  uploaded_by: Identifier | null;
  mime_type: string;
  size: number;
};

/**
 * Story 5.8: a resume belongs to EITHER a shidduch OR a single (never
 * both, never neither — `resumes_owner_check`, `01_tables.sql`), so both
 * owner columns are optional here rather than `shidduchim_id` staying
 * required. Prefer `resumes/resumeSubject.ts#ResumeSubject` at any call
 * site that needs the exactly-one-of guarantee typed — this shape exists to
 * match the wire row, not to be constructed by hand.
 */
export type Resume = {
  account_id: Identifier;
  shidduchim_id?: Identifier | null;
  single_id?: Identifier | null;
  files?: ResumeFileVersion[] | null;
  extracted?: unknown;
  sections?: unknown;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * `resume_photos.visibility` (Story 5.4) — the narrower subset of
 * `ShidduchVisibility` that means something for a photo of the suggested
 * person: `private_single` would hide it from its own uploader (the
 * process manager), which is nonsense here, so the column's own CHECK
 * constraint excludes it.
 */
export type ResumePhotoVisibility = Extract<
  ShidduchVisibility,
  "shared" | "private_parent"
>;

/**
 * A row of `public.resume_photos` (Story 5.4): one row per uploaded photo of
 * the suggested person, replacing `resumes.photos jsonb`. RLS enforces at
 * ROW granularity, so per-photo visibility (unlike `Resume.files`, an
 * appended jsonb array) needs its own table. `path` embeds the visibility
 * segment (`{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{name}`)
 * — never resolved to a URL here; `signResumePhotoUrl` mints one per reveal
 * click and never persists it (AC 1). `hidden_at` is a soft-hide: a hidden
 * photo is excluded everywhere by a plain `hidden_at is null` filter, never
 * deleted.
 */
export type ResumePhoto = {
  account_id: Identifier;
  resume_id: Identifier;
  path: string;
  uploaded_at: string;
  visibility: ResumePhotoVisibility;
  hidden_at?: string | null;
} & Pick<RaRecord, "id">;

/**
 * A row of `public.medical_notes` (Story 5.5, the sensitive tier): a plain,
 * shidduch-scoped note table, never funnelled through `interactions` — RLS
 * (05_policies.sql) restricts every command to a caller whose ACTIVE
 * membership role is `parent_admin` or `self_manager`, so this type is only
 * ever populated for those two viewers. `author_member_id` is not
 * server-stamped (no trigger sets it, unlike `interactions.actor_member_id`)
 * because no AC requires per-note attribution — it stays optional and is
 * left null by every write path today.
 */
export type MedicalNote = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  author_member_id?: Identifier | null;
  body: string;
  created_at: string;
} & Pick<RaRecord, "id">;

/** The four call outcomes a shadchan actually records (FR40), plus "not started". */
export const CALL_STATUSES = [
  "not_started",
  "answered",
  "no_answer",
  "call_back",
  "they_will_call_back",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

/** One entry appended to reference_links.conversation_log by log_reference_call. */
export type ConversationLogEntry = {
  at: string;
  call_status?: CallStatus | null;
  text?: string | null;
  /** "manual" = the capture screen, "assistant" = the guided call script. */
  source: "manual" | "assistant";
  member_id?: Identifier | null;
};

export type ReferenceLink = {
  account_id: Identifier;
  reference_id: Identifier;
  shidduchim_id?: Identifier | null;
  resume_id?: Identifier | null;
  call_status?: CallStatus | null;
  what_they_said?: string | null;
  conversation_log?: ConversationLogEntry[] | null;
  /**
   * The same person can be "the shul rabbi" for one shidduch and "a family
   * friend" for another. Null falls back to references.relationship.
   */
  relationship_override?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * reference_links_summary — one row per reference<->shidduch conversation.
 * Serves both the per-shidduch call-log cards and the repeat-recognition panel.
 */
export type ReferenceLinkSummary = ReferenceLink & {
  effective_relationship?: string | null;
  conversation_log_count: number;
  reference_name_en?: string | null;
  reference_name_he?: string | null;
  reference_phone?: string | null;
  shidduch_name_en?: string | null;
  shidduch_name_he?: string | null;
  shidduch_pipeline_state?: PipelineState | null;
  shidduch_visibility?: string | null;
  single_id?: Identifier | null;
  single_first_name_en?: string | null;
  single_first_name_he?: string | null;
};

/**
 * Polymorphic interaction timeline (AD-13). A note is just kind === "note".
 * `single_input` (Story 5.7) is the read-side half of Epic 6's Story 6.4:
 * a `target_type = 'shidduch'` row the single will eventually write once
 * that story lands the write path. Widening this union without an entry in
 * `entity360/tabs/interactionLabels.ts`'s `INTERACTION_KIND_LABELS`
 * (`Record<InteractionKind, …>`) is an immediate `tsc` error by design.
 */
export type InteractionKind =
  | "note"
  | "call_logged"
  | "status_change"
  | "merge"
  | "link_created"
  | "link_removed"
  | "single_input";

/**
 * Which parent an interaction derives its visibility from (AD-3). Not a
 * visibility value: "shidduch" means look it up by joining to the parent
 * shidduch, "account" means there is no shidduch parent to look up. The database
 * rejects a row that is neither, so no interaction can escape both checks.
 */
export type InteractionScope = "shidduch" | "account";

export type Interaction = {
  account_id: Identifier;
  target_type: EntityTargetType;
  target_id: Identifier;
  scope: InteractionScope;
  /** Required when scope is "shidduch", forbidden when it is "account". */
  reference_link_id?: Identifier | null;
  actor_member_id?: Identifier | null;
  kind: InteractionKind;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  /** Soft-delete (Story 3.5 owns the column and this read filter; Story 3.6
   *  owns the write path, its moderation policy and its UI). */
  deleted_at?: string | null;
} & Pick<RaRecord, "id">;

/**
 * A row of `public.entity_files` (Story 3.7): the Files tab's storage
 * catalog. One row per uploaded object in the private `entity-files` bucket,
 * addressed by `storage_path` — never by a URL. AC 5 forbids storing one:
 * `signEntityFileUrl()` mints a signed URL per click and never persists it.
 * Polymorphic (AD-13) like `Task`/`Interaction`, and — unlike them —
 * `target_type` was at full `ENTITY_TARGET_TYPES` parity from creation
 * (`entity360/pendingDbWidenings.ts` never tracked it as pending).
 */
export type EntityFile = {
  account_id: Identifier;
  target_type: EntityTargetType;
  target_id: Identifier;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: EntityFileVisibility;
  uploaded_by_member_id?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * entity_files_summary — the Files tab's read path (AD-10): FilesTab LISTS
 * through this view and WRITES through `entity_files` directly. Adds the
 * uploader's server-resolved display name, the same shape
 * `interactions_summary`'s `author_name` uses.
 */
export type EntityFileSummary = EntityFile & {
  uploaded_by_name?: string | null;
};

/**
 * One deciding fact behind a match candidate. The matcher never returns a bare
 * boolean — the user is shown WHY two records look like the same person and
 * decides for themselves (AD-5).
 */
export type MatchDecidingFact = {
  signal: "phone" | "name" | "parents" | "school" | "shul" | "location";
  detail: string;
};

/** A candidate returned by match-on-entry, complete enough to render as a card. */
export type ReferenceMatchCandidate = {
  reference_id: Identifier;
  confidence: number;
  deciding_facts: MatchDecidingFact[];
  name_en?: string | null;
  name_he?: string | null;
  phone?: string | null;
  relationship?: string | null;
  school?: string | null;
  grad_year?: number | null;
  linked_shidduchim_count: number;
};

export type MatchReferenceInput = {
  name_en?: string | null;
  name_he?: string | null;
  phone?: string | null;
  school?: string | null;
  /** Excluded from its own candidate list when re-matching an existing row. */
  exclude_id?: Identifier | null;
};

/**
 * One prior suggestion returned by catch_shidduch() (E3): the same person was
 * redt before, for this or another single in the family. Carries the confidence
 * and deciding facts (never a bare score) plus enough prior context to render
 * the "you've come across this person before" panel in one hop. age is shown as
 * informational context only — it is NEVER a matching signal (FR11).
 */
export type ShidduchCatchSuggestion = {
  prior_shidduchim_id: Identifier;
  confidence: number;
  deciding_facts: MatchDecidingFact[];
  name_en?: string | null;
  name_he?: string | null;
  age?: number | null;
  pipeline_state: PipelineState;
  first_suggested_at?: string | null;
  redt_date?: string | null;
  single_id?: Identifier | null;
  single_first_name_en?: string | null;
  single_first_name_he?: string | null;
  shadchan_name?: string | null;
};

/**
 * A prior date for the same person, discovered honestly from date_records with
 * the shared normalizers and held to the same name + corroborator bar as the
 * identity matcher (never name-only, never fabricated). Omitted entirely when no
 * corroborated match exists.
 */
export type ShidduchDatePrior = {
  date_record_id: Identifier;
  person_name_en?: string | null;
  person_name_he?: string | null;
  date_on?: string | null;
  outcome?: string | null;
  single_id?: Identifier | null;
  single_first_name_en?: string | null;
};

/** The full catch payload for one shidduch — what catch_shidduch() returns. */
export type ShidduchCatch = {
  has_catch: boolean;
  suggestions: ShidduchCatchSuggestion[];
  dates: ShidduchDatePrior[];
};

/** Billing (E4). 'free' = free-forever tier; 'ai' = the paid AI tier. */
export type SubscriptionPlan = "free" | "ai";

/**
 * 'active' = entitled and paid; 'lapsed' = was paid, now expired (a graceful
 * pause — AI auto-fill stops, nothing is lost, the free manual path stays);
 * 'none' = never subscribed.
 */
export type SubscriptionStatus = "active" | "lapsed" | "none";

/**
 * The server-authoritative entitlement payload returned by the ai_entitlement()
 * RPC (02_functions.sql) — the SINGLE source of truth for "may this account
 * spend inference?". `is_entitled` is computed on the server from the
 * SELECT-only `subscription` table, so a modified client cannot forge it; the
 * matching field names mirror the jsonb the function returns. `resumes_used /
 * resumes_limit` back the calm usage meter (free tier gets a limit of 0).
 */
export type AiEntitlementInfo = {
  is_entitled: boolean;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  resumes_used: number;
  resumes_limit: number;
};

export type LinkReferenceInput = {
  reference_id: Identifier;
  shidduchim_id: Identifier;
  relationship_override?: string | null;
};

export type LogReferenceCallInput = {
  reference_link_id: Identifier;
  call_status?: CallStatus | null;
  what_they_said?: string | null;
  source?: "manual" | "assistant";
};

/**
 * How the user resolved one same-shidduch collision during a merge. The merge
 * refuses to run until every collision has an answer.
 */
export type MergeResolution = "winner" | "loser" | "both";

export type ReferenceMergeCollision = {
  shidduchim_id: Identifier;
  shidduch_name_en?: string | null;
  shidduch_name_he?: string | null;
  loser_link: {
    id: Identifier;
    call_status?: CallStatus | null;
    what_they_said?: string | null;
    conversation_log_count: number;
  };
  winner_link: {
    id: Identifier;
    call_status?: CallStatus | null;
    what_they_said?: string | null;
    conversation_log_count: number;
  };
};

export type ReferenceMergePreview = {
  loser: Reference;
  winner: Reference;
  reference_links_count: number;
  interactions_count: number;
  open_tasks_count: number;
  collisions: ReferenceMergeCollision[];
};

export type DateRecord = {
  account_id: Identifier;
  single_id?: Identifier | null;
  person_name_en?: string | null;
  person_name_he?: string | null;
  person_parents?: string | null;
  person_seminary?: string | null;
  person_location?: string | null;
  date_on?: string | null;
  outcome?: string | null;
  notes?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

export type PipelineTransition = {
  from_state: PipelineState;
  to_state: PipelineState;
};

/**
 * Story 4.5: the exactly-three resources the global-search fan-out
 * (`misc/useGlobalSearch.ts`) searches. A CLOSED union, not `string` — every
 * browsable entity that exists by the end of Epic 4, and deliberately NOT a
 * fourth: `references` is excluded by RULING 7 (see the story's Dev Notes,
 * "Why references is not searchable" — a reference has no nav entry, no
 * list and no global-search results). Epic 8 widens this union when it adds
 * shadchanus-context entities; until then, widening it is a typecheck
 * event, not a silent broadening.
 */
export type GlobalSearchResource = "singles" | "shidduchim" | "shadchanim";

/**
 * One row the global-search fan-out renders (AC-2/AC-3). Deliberately does
 * NOT carry a resolved path — `GlobalSearch.tsx` resolves `href` at render
 * time via `buildRecordPath` (through `RecordLink`), which reads the
 * entity's own descriptor; baking a path in here would freeze Epic 5's
 * per-entity route flips out of this result set.
 */
export type GlobalSearchResult = {
  resource: GlobalSearchResource;
  id: Identifier;
  label_en: string;
  label_he?: string | null;
  subtitle?: string | null;
};

// =====================================================================
// MyShadchan — Communication (Epic 7: threads, AD-1, AD-20, AD-22)
// =====================================================================

/**
 * Story 7.1 (AC-1): the only two subject shapes a thread admits today. A
 * `relationship` thread is a general conversation not tied to one shidduch
 * (`subject_id` is null); a `shidduch` thread always names one.
 */
export type ThreadSubjectType = "shidduch" | "relationship";

/**
 * Story 7.1 (AC-3): `'private'` is fully modelled by this story's schema —
 * its ENFORCEMENT (a participant-only read branch) is Story 7.3's job. Do
 * not infer that `'private'` is already private; see the story's own Dev
 * Notes, "What this story does not do".
 */
export type ThreadVisibility = "open" | "private";

/**
 * A connection (AD-20): a THIRD scope, owned by neither the household nor
 * the shadchanus account — the FK target `Thread.connection_id` points at
 * when a thread is not account-scoped. Read-only to the SPA in this story;
 * the consent workflow (propose/accept/end) is Epic 8.
 */
export type Connection = {
  household_account_id: Identifier;
  shadchanus_account_id: Identifier;
  status: "accepted" | "ended";
  ended_at?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * Story 7.1 (AC-1, AC-3, AC-5): a structured, subject-scoped conversation.
 * Carries BOTH `account_id` and `connection_id` (exactly one non-null, AD-1)
 * from the moment the schema exists. Story 7.4 opens the connection axis at
 * the database layer (`create_thread()`'s `p_connection_id`) — see
 * `CreateThreadInput` below — though no built UI reaches it yet.
 */
export type Thread = {
  account_id?: Identifier | null;
  connection_id?: Identifier | null;
  subject_type: ThreadSubjectType;
  subject_id?: Identifier | null;
  visibility: ThreadVisibility;
  created_by_member_id?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * Story 7.1 (AC-2): who is in a thread's conversation. Never derived from
 * "everyone in the scope" — every thread has at least one participant row
 * (its creator) from the moment it is created (`create_thread()`).
 */
export type ThreadParticipant = {
  account_id?: Identifier | null;
  connection_id?: Identifier | null;
  thread_id: Identifier;
  member_id: Identifier;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * Story 7.1 (AC-4): a structured message row, never appended to the generic
 * `interactions` timeline. Append-only — there is no UPDATE/DELETE RLS
 * policy or grant for `authenticated` (05_policies.sql / 06_grants.sql), so
 * the dataProvider never exposes an edit or delete path for one.
 */
export type Message = {
  account_id?: Identifier | null;
  connection_id?: Identifier | null;
  thread_id: Identifier;
  sender_member_id?: Identifier | null;
  body: string;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * Input accepted by `createThread()` — mirrors the `create_thread` RPC
 * (AD-4's "one creation path" precedent). Story 7.4 (AC-1) adds
 * `connection_id`: when supplied, the thread is created connection-scoped
 * (`account_id` null) instead of account-scoped — the axis is chosen by this
 * field's presence, never both. No built UI sets it yet (Dev Notes, "The
 * surface honesty note") — `connections` has no client write path
 * (7.1 AC-6), so a real caller cannot reach one to pass here until Epic 8.
 */
export type CreateThreadInput = {
  subject_type: ThreadSubjectType;
  subject_id?: Identifier | null;
  participant_member_ids?: Identifier[];
  visibility?: ThreadVisibility;
  connection_id?: Identifier | null;
};

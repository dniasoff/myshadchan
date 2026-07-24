import type { Identifier, RaRecord } from "ra-core";
import type { ComponentType } from "react";

import type {
  COMPANY_CREATED,
  CONTACT_CREATED,
  CONTACT_NOTE_CREATED,
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
} from "./consts";

export type SignUpData = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type SalesFormData = {
  avatar?: string;
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  administrator: boolean;
  disabled: boolean;
};

export type Sale = {
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

export type Company = {
  name: string;
  logo: RAFile;
  sector: string;
  size: 1 | 10 | 50 | 250 | 500;
  linkedin_url: string;
  website: string;
  phone_number: string;
  address: string;
  zipcode: string;
  city: string;
  state_abbr: string;
  sales_id?: Identifier;
  created_at: string;
  description: string;
  revenue: string;
  tax_identifier: string;
  country: string;
  context_links?: string[];
  nb_contacts?: number;
  nb_deals?: number;
} & Pick<RaRecord, "id">;

export type EmailAndType = {
  email: string;
  type: "Work" | "Home" | "Other";
};

export type PhoneNumberAndType = {
  number: string;
  type: "Work" | "Home" | "Other";
};

export type Contact = {
  first_name: string;
  last_name: string;
  title: string;
  company_id?: Identifier | null;
  email_jsonb: EmailAndType[];
  avatar?: Partial<RAFile>;
  linkedin_url?: string | null;
  first_seen: string;
  last_seen: string;
  has_newsletter: boolean;
  tags: number[];
  gender: string;
  sales_id?: Identifier;
  status: string;
  background: string;
  phone_jsonb: PhoneNumberAndType[];
  nb_tasks?: number;
  company_name?: string;
} & Pick<RaRecord, "id">;

export type ContactNote = {
  contact_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  status: string;
  attachments?: AttachmentNote[];
} & Pick<RaRecord, "id">;

export type Deal = {
  name: string;
  company_id: Identifier;
  contact_ids: Identifier[];
  category: string;
  stage: string;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  expected_closing_date: string;
  sales_id: Identifier;
  index: number;
} & Pick<RaRecord, "id">;

export type DealNote = {
  deal_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  attachments?: AttachmentNote[];

  // This is defined for compatibility with `ContactNote`
  status?: undefined;
} & Pick<RaRecord, "id">;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

/**
 * Tasks/reminders. Widened from contacts-only to the AD-13 polymorphic shape so
 * a reminder can hang off a shadchan, a shidduch or a reference (FR44-46).
 * `contact_id` is retained for the legacy contacts UI and is kept in step with
 * target_type/target_id by a database trigger — set either, never both.
 */
export type TaskTargetType = "contact" | "shadchan" | "shidduch" | "reference";

/** Delivery is in-app + email (primary) + push. There is deliberately no SMS. */
export type TaskDeliveryChannel = "in_app" | "email" | "push";

export type Task = {
  contact_id?: Identifier | null;
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
  account_id?: Identifier;
  target_type?: TaskTargetType;
  target_id?: Identifier;
  delivery_channels?: TaskDeliveryChannel[];
} & Pick<RaRecord, "id">;

export type ActivityCompanyCreated = {
  type: typeof COMPANY_CREATED;
  company_id: Identifier;
  company: Company;
  sales_id: Identifier;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactCreated = {
  type: typeof CONTACT_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  contact: Contact;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactNoteCreated = {
  type: typeof CONTACT_NOTE_CREATED;
  sales_id?: Identifier;
  contactNote: ContactNote;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityDealCreated = {
  type: typeof DEAL_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  deal: Deal;
  date: string;
};

export type ActivityDealNoteCreated = {
  type: typeof DEAL_NOTE_CREATED;
  sales_id?: Identifier;
  dealNote: DealNote;
  date: string;
};

export type Activity = RaRecord &
  (
    | ActivityCompanyCreated
    | ActivityContactCreated
    | ActivityContactNoteCreated
    | ActivityDealCreated
    | ActivityDealNoteCreated
  );

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export type AttachmentNote = RAFile;

export interface LabeledValue {
  value: string;
  label: string;
}

export type DealStage = LabeledValue;

export interface NoteStatus extends LabeledValue {
  color: string;
}

export interface ContactGender {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

// =====================================================================
// MyShadchan — Shidduchim pipeline domain (AD-4, AD-12)
// =====================================================================

/** The one canonical pipeline state (AD-4): exactly 7 values, no substate. */
export type PipelineState =
  "new" | "look_into" | "not_sure" | "for_sure_not" | "yes" | "unsure" | "no";

export type MemberRole =
  "parent_admin" | "helper" | "self_manager" | "shadchan";

export type ShidduchOrigin = "channel" | "manual" | "shadchan";

export type ShidduchVisibility = "shared" | "private_parent" | "private_child";

export type Account = {
  name: string;
  transparency_level: string;
  data_region?: string | null;
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

export type Child = {
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
 * children_summary — per-child pipeline counts (E6). Every Child field plus a
 * total suggestion count and an "open" (still-in-triage) count, so the roster
 * card shows "N in pipeline" without an N+1 fetch.
 */
export type ChildSummary = Child & {
  total_shidduchim: number;
  open_shidduchim: number;
};

// =====================================================================
// MyShadchan — Read-only child portal (E7)
// =====================================================================

/**
 * An unguessable, revocable per-child portal link (child_portal_tokens). The
 * child is NOT an account user; this token is the ONLY key to their read-only
 * portal. `token` is server-generated (a BEFORE INSERT trigger forces a CSPRNG
 * value) — the client never chooses it and only ever reads it back after minting.
 */
export type ChildPortalToken = {
  account_id: Identifier;
  child_id: Identifier;
  token: string;
  revoked_at?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * One child-facing suggestion card. Deliberately narrow: the prospect's name, a
 * calm status label, and the redt date — nothing else. get_child_portal() never
 * returns diligence, references, private notes, age/height, the shadchan, the raw
 * pipeline_state, or any internal id.
 */
export type ChildPortalSuggestion = {
  name_en?: string | null;
  name_he?: string | null;
  redt_date: string;
  status_label: string | null;
};

/**
 * What get_child_portal(token) returns for a valid, non-revoked token. `null` is
 * returned instead for an unknown or revoked token (no oracle either way).
 */
export type ChildPortalData = {
  child: {
    first_name_en?: string | null;
    first_name_he?: string | null;
  };
  suggestions: ChildPortalSuggestion[];
};

export type Shadchan = {
  account_id: Identifier;
  name: string;
  name_he?: string | null;
  location?: string | null;
  contacts?: unknown;
  notes?: string | null;
  responsiveness?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * shadchan_stats — per-shadchan productivity counts (E5). Keyed on the
 * shadchan's id. Mirrors the "Suggestions from this shadchan" list, which
 * filters shidduchim by shadchan_id, so the tiles agree with the list.
 * A "led to dates" metric is intentionally absent: date_records carries no
 * shadchan linkage, so there is no honest field to count.
 */
export type ShadchanStats = {
  account_id: Identifier;
  nb_suggestions: number;
  nb_progressed: number;
  nb_reached_yes: number;
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

/** The central object (AD-4): one child, one canonical pipeline_state. */
export type Shidduch = {
  account_id: Identifier;
  child_id: Identifier;
  shadchan_id?: Identifier | null;
  name_en?: string | null;
  name_he?: string | null;
  parents_en?: string | null;
  parents_he?: string | null;
  seminary_en?: string | null;
  seminary_he?: string | null;
  shul_en?: string | null;
  shul_he?: string | null;
  location_en?: string | null;
  location_he?: string | null;
  age?: number | null;
  height?: string | null;
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
  child_first_name_en?: string | null;
  child_first_name_he?: string | null;
  child_last_name_en?: string | null;
  child_last_name_he?: string | null;
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

/** Input accepted by createShidduch() — mirrors the create_shidduch RPC (AD-4). */
export type CreateShidduchInput = {
  child_id: Identifier;
  shadchan_id?: Identifier | null;
  name_en?: string | null;
  name_he?: string | null;
  parents_en?: string | null;
  parents_he?: string | null;
  seminary_en?: string | null;
  seminary_he?: string | null;
  shul_en?: string | null;
  shul_he?: string | null;
  location_en?: string | null;
  location_he?: string | null;
  age?: number | null;
  height?: string | null;
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
 * resolve step (which child / which shadchan) turns it into a shidduch.
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
  child_id?: Identifier | null;
  shadchan_id?: Identifier | null;
  resolved_shidduchim_id?: Identifier | null;
};

export type Resume = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  files?: unknown;
  photos?: unknown;
  extracted?: unknown;
  sections?: unknown;
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
  child_id?: Identifier | null;
  child_first_name_en?: string | null;
  child_first_name_he?: string | null;
};

/** Polymorphic interaction timeline (AD-13). A note is just kind === "note". */
export type InteractionKind =
  | "note"
  | "call_logged"
  | "status_change"
  | "merge"
  | "link_created"
  | "link_removed";

/**
 * Which parent an interaction derives its visibility from (AD-3). Not a
 * visibility value: "shidduch" means look it up by joining to the parent
 * shidduch, "account" means there is no shidduch parent to look up. The database
 * rejects a row that is neither, so no interaction can escape both checks.
 */
export type InteractionScope = "shidduch" | "account";

export type Interaction = {
  account_id: Identifier;
  target_type: "reference" | "shidduch";
  target_id: Identifier;
  scope: InteractionScope;
  /** Required when scope is "shidduch", forbidden when it is "account". */
  reference_link_id?: Identifier | null;
  actor_member_id?: Identifier | null;
  kind: InteractionKind;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
} & Pick<RaRecord, "id">;

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
 * redt before, for this or another child in the family. Carries the confidence
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
  child_id?: Identifier | null;
  child_first_name_en?: string | null;
  child_first_name_he?: string | null;
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
  child_id?: Identifier | null;
  child_first_name_en?: string | null;
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
 * How the user resolved one same-shidduch collision during a merge. This case
 * has no equivalent for contacts, and the merge refuses to run until every
 * collision has an answer.
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
  child_id?: Identifier | null;
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

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

export type Task = {
  contact_id: Identifier;
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
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

export type Reference = {
  account_id: Identifier;
  name_en?: string | null;
  name_he?: string | null;
  relationship?: string | null;
  phone?: string | null;
  school?: string | null;
  grad_year?: number | null;
  created_at: string;
} & Pick<RaRecord, "id">;

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

export type Resume = {
  account_id: Identifier;
  shidduchim_id: Identifier;
  files?: unknown;
  photos?: unknown;
  extracted?: unknown;
  sections?: unknown;
  created_at: string;
} & Pick<RaRecord, "id">;

export type ReferenceLink = {
  account_id: Identifier;
  reference_id: Identifier;
  shidduchim_id?: Identifier | null;
  resume_id?: Identifier | null;
  call_status?: string | null;
  what_they_said?: string | null;
  conversation_log?: unknown;
  created_at: string;
} & Pick<RaRecord, "id">;

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

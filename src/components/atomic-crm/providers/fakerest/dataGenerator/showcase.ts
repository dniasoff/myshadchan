import generateData from "./index";
import { assetBase64, type AssetKey } from "./assets";
import { seedShowcaseProfileAssets } from "./fileAssets";
import type { Db } from "./types";
import type { Shidduch } from "../../../types";

const ACCOUNT_ID = 1;
const HOUSEHOLD_MEMBER_ID = 1;
const SECOND_MEMBER_ID = 3;
const SHOWCASE_DATE = "2026-08-01T00:00:00.000Z";
const SHOWCASE_DAY = "2026-08-01";

const pipelineStates: Shidduch["pipeline_state"][] = [
  "new",
  "look_into",
  "not_sure",
  "for_sure_not",
  "yes",
  "unsure",
  "no",
];

const candidateDetails: Record<number, Partial<Shidduch>> = {
  1: {
    father_en: "Michael Rosenberg",
    mother_en: "Sarah Rosenberg",
    age: 25,
    height: "5'11\"",
    dob: "2001-02-14",
    background: "Baltimore yeshivish; warm, steady, and community-minded.",
    shul_en: "Congregation Ner Tamid",
  },
  2: {
    father_en: "David Stern",
    mother_en: "Rachel Stern",
    age: 26,
    height: "6'0\"",
    dob: "2000-11-09",
    background:
      "Brooklyn yeshivish; thoughtful learner with a practical streak.",
    shul_en: "Kehillas Ohr Hachaim",
  },
  3: {
    father_en: "Moshe Sofer",
    mother_en: "Leah Sofer",
    age: 24,
    height: "5'10\"",
    dob: "2002-01-22",
    background:
      "Lakewood BMG family; serious about learning and easy to talk to.",
    shul_en: "Bais Medrash Avodas Hashem",
  },
  4: {
    father_en: "Yitzchok Berkowitz",
    mother_en: "Chana Berkowitz",
    age: 25,
    height: "5'9\"",
    dob: "2001-06-04",
    background: "Lakewood; masmid with excellent middos and a close family.",
    shul_en: "Bais Medrash of Lakewood",
  },
  5: {
    father_en: "Avi Katz",
    mother_en: "Miriam Katz",
    age: 27,
    height: "6'1\"",
    dob: "1999-12-18",
    background:
      "Monsey; learns b'iyun and works part-time in a family business.",
    shul_en: "Young Israel of Monsey",
  },
  6: {
    father_en: "Eli Fried",
    mother_en: "Tova Fried",
    age: 25,
    height: "5'10\"",
    dob: "2001-08-27",
    background:
      "Cleveland Torah family; personable, responsible, and grounded.",
    shul_en: "Ohr Torah Cleveland",
  },
  7: {
    father_en: "Yehuda Klein",
    mother_en: "Rivka Klein",
    age: 26,
    height: "5'11\"",
    dob: "2000-03-12",
    background: "Lakewood; organized, warm, and very connected to his rebbeim.",
    shul_en: "Bais Medrash Shaarei Tefillah",
  },
  8: {
    father_en: "Shlomo Diamond",
    mother_en: "Esther Diamond",
    age: 24,
    height: "5'8\"",
    dob: "2002-04-30",
    background: "Monsey; creative, upbeat, and committed to continued growth.",
    shul_en: "Kehillas Ohr Somayach",
  },
  9: {
    father_en: "Avrohom Traube",
    mother_en: "Devorah Traube",
    age: 28,
    height: "6'0\"",
    dob: "1998-10-08",
    background:
      "Baltimore; mature and easygoing, with a strong learning routine.",
    shul_en: "Congregation Shomrei Emunah",
  },
  10: {
    father_en: "Yosef Landau",
    mother_en: "Bracha Landau",
    age: 25,
    height: "5'10\"",
    dob: "2001-05-19",
    background: "Monsey; warm baal middos who balances learning and work well.",
    shul_en: "Ohr Torah of Monsey",
  },
  11: {
    father_en: "Mendel Gross",
    mother_en: "Chani Gross",
    age: 26,
    height: "5'11\"",
    dob: "2000-09-06",
    background: "Lakewood; polished, thoughtful, and well-liked by his peers.",
    shul_en: "Bais Medrash Ohr Hachaim",
  },
  12: {
    father_en: "Yitzchok Adler",
    mother_en: "Rina Adler",
    age: 24,
    height: "5'9\"",
    dob: "2002-02-11",
    background:
      "Baltimore; sincere, articulate, and focused on building a home.",
    shul_en: "Ner Yisroel Community Kollel",
  },
  13: {
    father_en: "Shimon Berger",
    mother_en: "Ruth Berger",
    age: 27,
    height: "6'1\"",
    dob: "1999-07-21",
    background: "Lakewood; bright and kind, with a calm, low-key personality.",
    shul_en: "Bais Medrash Maor Shlomo",
  },
  14: {
    father_en: "Yosef Steinberg",
    mother_en: "Miriam Steinberg",
    age: 23,
    height: "5'4\"",
    dob: "2003-01-15",
    background:
      "Passaic Bnos Chava family; warm, capable, and family-oriented.",
    shul_en: "Congregation Shaarei Torah",
  },
  15: {
    father_en: "Daniel Roth",
    mother_en: "Chaya Roth",
    age: 24,
    height: "5'5\"",
    dob: "2002-06-23",
    background:
      "Baltimore Bais Yaakov family; dependable, warm, and articulate.",
    shul_en: "Ohr Chadash Baltimore",
  },
  16: {
    father_en: "Yehuda Weinberg",
    mother_en: "Tzipporah Weinberg",
    age: 23,
    height: "5'3\"",
    dob: "2003-03-07",
    background:
      "Lakewood Bnos Devorah family; responsible and quietly confident.",
    shul_en: "Kehillas Bais Yaakov",
  },
};

const showcaseYaakovCandidates: Shidduch[] = [
  {
    id: 17,
    account_id: ACCOUNT_ID,
    single_id: 2,
    shadchan_id: 4,
    name_en: "Tamar Weiss",
    name_he: null,
    father_en: "Yosef Weiss",
    father_he: null,
    mother_en: "Miriam Weiss",
    mother_he: null,
    seminary_en: "Bnos Binah",
    seminary_he: null,
    shul_en: "Congregation Beth Torah",
    shul_he: null,
    location_en: "Lakewood, NJ",
    location_he: null,
    age: 22,
    height: "5'4\"",
    dob: "2004-01-29",
    background:
      "Warm Lakewood family; thoughtful, creative, and community-minded.",
    marital_status: "single",
    existing_children_note: null,
    pipeline_state: "not_sure",
    first_suggested_by: 4,
    first_suggested_at: "2026-07-24T00:00:00.000Z",
    redt_date: "2026-07-24",
    close_reason: null,
    origin: "shadchan",
    owner_member_id: null,
    visibility: "shared",
    index: 0,
    created_at: "2026-07-24T00:00:00.000Z",
  },
  {
    id: 18,
    account_id: ACCOUNT_ID,
    single_id: 2,
    shadchan_id: 2,
    name_en: "Ariella Cohen",
    name_he: null,
    father_en: "Chaim Cohen",
    father_he: null,
    mother_en: "Shoshana Cohen",
    mother_he: null,
    seminary_en: "Bnos Chaim",
    seminary_he: null,
    shul_en: "Young Israel of Passaic",
    shul_he: null,
    location_en: "Passaic, NJ",
    location_he: null,
    age: 23,
    height: "5'5\"",
    dob: "2003-04-17",
    background:
      "Passaic family; sincere, organized, and very close with her siblings.",
    marital_status: "single",
    existing_children_note: null,
    pipeline_state: "for_sure_not",
    first_suggested_by: 2,
    first_suggested_at: "2026-07-16T00:00:00.000Z",
    redt_date: "2026-07-16",
    close_reason: "Different hashkafic direction",
    origin: "manual",
    owner_member_id: null,
    visibility: "shared",
    index: 0,
    created_at: "2026-07-16T00:00:00.000Z",
  },
  {
    id: 19,
    account_id: ACCOUNT_ID,
    single_id: 2,
    shadchan_id: 1,
    name_en: "Chani Levine",
    name_he: null,
    father_en: "Yitzchok Levine",
    father_he: null,
    mother_en: "Rochel Levine",
    mother_he: null,
    seminary_en: "Bais Yaakov of the Lower East Side",
    seminary_he: null,
    shul_en: "Congregation Ohr Avrohom",
    shul_he: null,
    location_en: "Baltimore, MD",
    location_he: null,
    age: 24,
    height: "5'6\"",
    dob: "2002-08-02",
    background:
      "Baltimore; warm, articulate, and committed to a balanced home.",
    marital_status: "single",
    existing_children_note: null,
    pipeline_state: "unsure",
    first_suggested_by: 1,
    first_suggested_at: "2026-07-13T00:00:00.000Z",
    redt_date: "2026-07-13",
    close_reason: null,
    origin: "manual",
    owner_member_id: null,
    visibility: "shared",
    index: 0,
    created_at: "2026-07-13T00:00:00.000Z",
  },
  {
    id: 20,
    account_id: ACCOUNT_ID,
    single_id: 2,
    shadchan_id: 3,
    name_en: "Miriam Kaplan",
    name_he: null,
    father_en: "Shlomo Kaplan",
    father_he: null,
    mother_en: "Tova Kaplan",
    mother_he: null,
    seminary_en: "Bnos Sarah",
    seminary_he: null,
    shul_en: "Kehillas Torah V'Chesed",
    shul_he: null,
    location_en: "Monsey, NY",
    location_he: null,
    age: 25,
    height: "5'4\"",
    dob: "2001-10-26",
    background:
      "Monsey; mature, warm, and known for her calm, thoughtful nature.",
    marital_status: "single",
    existing_children_note: null,
    pipeline_state: "no",
    first_suggested_by: 3,
    first_suggested_at: "2026-06-21T00:00:00.000Z",
    redt_date: "2026-06-21",
    close_reason: "Timing and location were not aligned",
    origin: "manual",
    owner_member_id: null,
    visibility: "shared",
    index: 0,
    created_at: "2026-06-21T00:00:00.000Z",
  },
];

const stableMemberDetails: Record<
  number,
  Pick<Db["members"][number], "first_name" | "last_name" | "email">
> = {
  1: {
    first_name: "Dovid",
    last_name: "Klein",
    email: "dovid.klein@demo.invalid",
  },
  2: {
    first_name: "Leah",
    last_name: "Feldman",
    email: "leah.feldman@demo.invalid",
  },
  3: {
    first_name: "Miriam",
    last_name: "Gross",
    email: "miriam.gross@demo.invalid",
  },
  4: {
    first_name: "Chani",
    last_name: "Feldman",
    email: "chani.feldman@demo.invalid",
  },
  5: { first_name: "Avi", last_name: "Roth", email: "avi.roth@demo.invalid" },
};

function nextId(rows: Array<{ id: unknown }>): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1;
}

function mergeShowcaseRows<T extends { id: unknown }>(
  existing: T[],
  showcase: T[],
): T[] {
  const showcaseIds = new Set(showcase.map((row) => String(row.id)));
  return [
    ...existing.filter((row) => !showcaseIds.has(String(row.id))),
    ...showcase,
  ];
}

function pdfDataUrl(asset: AssetKey): string {
  return `data:application/pdf;base64,${assetBase64(asset)}`;
}

function cloneDb(base: Db): Db {
  const db = { ...base } as Db;
  for (const key of Object.keys(db) as Array<keyof Db>) {
    const value = db[key];
    if (Array.isArray(value)) {
      (db as unknown as Record<string, unknown>)[key] = [...value];
    }
  }
  return db;
}

function normalizeExistingDates(db: Db): void {
  db.resumes = db.resumes.map((resume) => ({
    ...resume,
    created_at: SHOWCASE_DATE,
    files: resume.files?.map((file) => ({
      ...file,
      uploaded_at: SHOWCASE_DATE,
    })),
  }));
  db.resume_photos = db.resume_photos.map((photo) => ({
    ...photo,
    uploaded_at: SHOWCASE_DATE,
  }));
  db.entity_files = db.entity_files.map((file) => ({
    ...file,
    created_at: SHOWCASE_DATE,
  }));
  db.medical_notes = db.medical_notes.map((note) => ({
    ...note,
    created_at: SHOWCASE_DATE,
  }));
  db.shidduchim_external_links = db.shidduchim_external_links.map((link) => ({
    ...link,
    created_at: SHOWCASE_DATE,
  }));
  db.date_records = db.date_records.map((record) => ({
    ...record,
    date_on: SHOWCASE_DAY,
    created_at: SHOWCASE_DATE,
  }));
  db.interactions = db.interactions.map((interaction) => ({
    ...interaction,
    created_at: SHOWCASE_DATE,
  }));
  db.analytics_events = db.analytics_events.map((event) => ({
    ...event,
    created_at: SHOWCASE_DATE,
  }));
}

const SHOWCASE_DATE_FIELDS = new Set([
  "created_at",
  "updated_at",
  "uploaded_at",
  "sent_at",
  "accessed_at",
  "accepted_at",
  "revoked_at",
  "expires_at",
  "due_date",
  "next_attempt_at",
  "claimed_at",
  "last_run_at",
  "last_ok_at",
  "done_date",
  "locked_at",
  "last_read_at",
  "first_suggested_at",
  "redt_date",
  "date_on",
]);

/**
 * Keep every showcase timestamp relative to the moment the fixture is
 * generated.  `generatedAt` is captured once by the caller, so fake timers
 * produce a deterministic, internally ordered graph while reseeding gets a
 * fresh timeline instead of teaching users stale 2026 dates.
 */
function makeShowcaseDatesDynamic(db: Db, generatedAt: Date): void {
  const offset = generatedAt.getTime() - Date.parse(SHOWCASE_DATE);
  if (!Number.isFinite(offset)) return;

  for (const value of Object.values(db)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (typeof row !== "object" || row === null) continue;
      for (const [key, cell] of Object.entries(row)) {
        if (!SHOWCASE_DATE_FIELDS.has(key) || typeof cell !== "string") {
          continue;
        }
        const parsed = Date.parse(
          key === "redt_date" || key === "date_on"
            ? `${cell}T00:00:00.000Z`
            : cell,
        );
        if (!Number.isFinite(parsed)) continue;
        const shifted = new Date(parsed + offset);
        (row as Record<string, unknown>)[key] =
          key === "redt_date" || key === "date_on"
            ? shifted.toISOString().slice(0, 10)
            : shifted.toISOString();
      }
    }
  }
}

function addShowcaseSuggestions(db: Db): void {
  const existingIds = new Set(db.shidduchim.map((row) => Number(row.id)));
  const enriched = db.shidduchim.map((row) => ({
    ...row,
    ...(candidateDetails[Number(row.id)] ?? {}),
    marital_status: row.marital_status ?? "single",
    // FakeRest must persist the same opposite-sex fact as the Edge seed;
    // deriving it here also covers baseline rows and future showcase rows.
    person_gender:
      row.person_gender ??
      (db.singles.find((single) => single.id === row.single_id)?.gender ===
      "female"
        ? "male"
        : "female"),
  }));
  const additions = showcaseYaakovCandidates
    .filter((row) => !existingIds.has(Number(row.id)))
    .map((row) => ({ ...row, person_gender: "female" }));
  db.shidduchim = [...enriched, ...additions];

  const redtId = nextId(db.redts);
  db.redts = [
    ...db.redts,
    ...additions.map((row, index) => ({
      id: redtId + index,
      account_id: ACCOUNT_ID,
      shidduchim_id: row.id,
      shadchan_id: row.shadchan_id ?? null,
      redt_date: row.redt_date,
      note: "Initial introduction shared with the family.",
      created_at: row.created_at,
    })),
  ];

  const educationId = nextId(db.shidduch_education);
  db.shidduch_education = [
    ...db.shidduch_education,
    ...additions.map((row, index) => ({
      id: educationId + index,
      account_id: ACCOUNT_ID,
      shidduchim_id: row.id,
      kind: "seminary" as const,
      name_en: row.seminary_en ?? null,
      name_he: null,
      start_year: null,
      end_year: null,
      created_at: row.created_at,
    })),
  ];

  for (const singleId of [1, 2]) {
    for (const state of pipelineStates) {
      db.shidduchim
        .filter(
          (row) => row.single_id === singleId && row.pipeline_state === state,
        )
        .forEach((row, index) => {
          row.index = index;
        });
    }
  }
}

function seedShowcaseCollections(db: Db): void {
  db.invites = mergeShowcaseRows(db.invites, [
    {
      id: 1,
      token: "showcase-invite-rivky",
      email: "rivky.klein@demo.invalid",
      account_id: ACCOUNT_ID,
      role: "single",
      invited_by: HOUSEHOLD_MEMBER_ID,
      target_single_id: 1,
      status: "accepted",
      expires_at: "2026-09-01T00:00:00.000Z",
      accepted_at: "2026-07-01T12:00:00.000Z",
      created_at: "2026-07-01T12:00:00.000Z",
    },
    {
      id: 2,
      token: "showcase-invite-yaakov",
      email: "yaakov.klein@demo.invalid",
      account_id: ACCOUNT_ID,
      role: "single",
      invited_by: HOUSEHOLD_MEMBER_ID,
      target_single_id: 2,
      status: "pending",
      expires_at: "2026-09-15T00:00:00.000Z",
      accepted_at: null,
      created_at: "2026-07-15T12:00:00.000Z",
    },
    {
      id: 3,
      token: "showcase-invite-miriam",
      email: "miriam.kaplan@demo.invalid",
      account_id: ACCOUNT_ID,
      role: "helper",
      invited_by: HOUSEHOLD_MEMBER_ID,
      target_single_id: null,
      status: "accepted",
      expires_at: "2026-09-30T00:00:00.000Z",
      accepted_at: "2026-07-16T12:00:00.000Z",
      created_at: "2026-07-16T12:00:00.000Z",
    },
  ]);

  db.single_preferences = mergeShowcaseRows(db.single_preferences, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      single_id: 1,
      body: "Looking for a warm, growth-oriented home with a strong learning atmosphere and room for shared interests.",
      visible_to_manager: true,
      created_at: "2026-07-03T09:00:00.000Z",
      updated_at: "2026-07-03T09:00:00.000Z",
    },
    {
      id: 2,
      account_id: ACCOUNT_ID,
      single_id: 2,
      body: "Hoping to meet someone thoughtful, family-oriented, and open to building a balanced home in the Northeast.",
      visible_to_manager: false,
      created_at: "2026-07-05T09:00:00.000Z",
      updated_at: "2026-07-05T09:00:00.000Z",
    },
  ]);

  db.single_notes = mergeShowcaseRows(db.single_notes, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      single_id: 1,
      body: "Rivky prefers a calm first conversation and appreciates direct communication.",
      visible_to_manager: false,
      created_at: "2026-07-08T10:00:00.000Z",
      updated_at: "2026-07-08T10:00:00.000Z",
    },
    {
      id: 2,
      account_id: ACCOUNT_ID,
      single_id: 2,
      body: "Yaakov is comfortable with a few nearby communities and wants family involvement to stay respectful and practical.",
      visible_to_manager: true,
      created_at: "2026-07-09T10:00:00.000Z",
      updated_at: "2026-07-09T10:00:00.000Z",
    },
  ]);

  db.connection_invites = mergeShowcaseRows(db.connection_invites, [
    {
      id: 1,
      inviter_account_id: 1,
      inviter_kind: "household",
      token_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      status: "accepted",
      expires_at: "2026-09-01T00:00:00.000Z",
      accepted_by_account_id: 2,
      accepted_at: "2026-07-02T12:00:00.000Z",
      revoked_at: null,
      created_at: "2026-07-02T12:00:00.000Z",
    },
    {
      id: 2,
      inviter_account_id: 2,
      inviter_kind: "shadchanus",
      token_hash:
        "2222222222222222222222222222222222222222222222222222222222222222",
      status: "revoked",
      expires_at: "2026-09-15T00:00:00.000Z",
      accepted_by_account_id: null,
      accepted_at: null,
      revoked_at: "2026-07-21T12:00:00.000Z",
      created_at: "2026-07-20T12:00:00.000Z",
    },
  ]);

  db.threads = db.threads.filter((row) => row.id === 1);
  db.threads = mergeShowcaseRows(db.threads, [
    {
      id: 1,
      account_id: null,
      connection_id: 1,
      subject_type: "relationship",
      subject_id: null,
      visibility: "private",
      created_by_member_id: HOUSEHOLD_MEMBER_ID,
      created_at: "2026-07-18T15:00:00.000Z",
    },
  ]);
  db.thread_participants = db.thread_participants.filter(
    (row) => row.id === 1 || row.id === 2,
  );
  db.thread_participants = mergeShowcaseRows(db.thread_participants, [
    {
      id: 1,
      account_id: null,
      connection_id: 1,
      thread_id: 1,
      member_id: HOUSEHOLD_MEMBER_ID,
      created_at: "2026-07-18T15:00:00.000Z",
      last_read_at: "2026-07-19T09:00:00.000Z",
    },
    {
      id: 2,
      account_id: null,
      connection_id: 1,
      thread_id: 1,
      member_id: SECOND_MEMBER_ID,
      created_at: "2026-07-18T15:01:00.000Z",
      last_read_at: null,
    },
  ]);
  db.messages = db.messages.filter((row) => row.id === 1 || row.id === 2);
  db.messages = mergeShowcaseRows(db.messages, [
    {
      id: 1,
      account_id: null,
      connection_id: 1,
      thread_id: 1,
      sender_member_id: HOUSEHOLD_MEMBER_ID,
      body: "The family received Dovid's resume and would like to check one more reference before suggesting a call.",
      created_at: "2026-07-18T15:05:00.000Z",
    },
    {
      id: 2,
      account_id: null,
      connection_id: 1,
      thread_id: 1,
      sender_member_id: SECOND_MEMBER_ID,
      body: "I spoke with Mrs. Feldman. She described him as steady, considerate, and very easy to work with.",
      created_at: "2026-07-19T09:20:00.000Z",
    },
  ]);
  db.message_notifications = db.message_notifications.filter(
    (row) => row.id === 1 || row.id === 2,
  );
  db.message_notifications = mergeShowcaseRows(db.message_notifications, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      connection_id: 1,
      status: "sent",
      simulated: true,
      sent_at: "2026-07-19T09:21:00.000Z",
      created_at: "2026-07-19T09:20:00.000Z",
    },
    {
      id: 2,
      account_id: ACCOUNT_ID,
      connection_id: 1,
      status: "sent",
      simulated: true,
      sent_at: "2026-07-19T16:06:00.000Z",
      created_at: "2026-07-19T16:05:00.000Z",
    },
  ]);

  // The primary single listing is withdrawn in the official bundle. Keep the
  // durable withdrawal lock, but do not leave an active listing in FakeRest.
  db.listings = db.listings.filter(
    (row) => !(row.account_id === ACCOUNT_ID && row.listing_type === "single"),
  );
  db.listings = mergeShowcaseRows(db.listings, [
    {
      id: 3,
      account_id: 2,
      listing_type: "shadchan",
      single_id: null,
      published_by_member_id: 2,
      shadchan_name: "Mrs. Feldman",
      shadchan_area: "Baltimore and surrounding communities",
      shadchan_contact_info: "feldmanmatches@demo.invalid",
      single_first_name_en: null,
      single_first_name_he: null,
      single_age: null,
      single_height: null,
      single_community: null,
      single_location: null,
      single_summary:
        "Experienced in thoughtful introductions for families who value discretion and follow-through.",
      created_at: "2026-07-10T12:00:00.000Z",
    },
  ]);
  db.listing_withdrawal_locks = mergeShowcaseRows(db.listing_withdrawal_locks, [
    {
      id: 1,
      single_id: 1,
      account_id: ACCOUNT_ID,
      locked_at: "2026-07-10T12:00:00.000Z",
    },
  ]);

  db.share_links = db.share_links.filter(
    (row) => row.account_id !== ACCOUNT_ID || row.id === 1,
  );
  db.share_links = mergeShowcaseRows(db.share_links, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      single_id: 1,
      created_by_member_id: HOUSEHOLD_MEMBER_ID,
      token: "showcase-share-rivky-2026",
      include_photo: false,
      expires_at: "2026-08-31T00:00:00.000Z",
      revoked_at: null,
      recipient_name: "Mrs. Gold",
      watermark: true,
      created_at: "2026-07-12T12:00:00.000Z",
    },
  ]);
  db.share_access_log = db.share_access_log.filter((row) => row.id === 1);
  db.share_access_log = mergeShowcaseRows(db.share_access_log, [
    {
      id: 1,
      share_link_id: 1,
      accessed_at: "2026-07-13T10:15:00.000Z",
      resource: "profile",
      ip_hash: null,
      user_agent: null,
      duration_ms: 420000,
      recipient_name: "Mrs. Gold",
      recipient_shadchan_id: null,
      simulated: true,
    },
  ]);

  db.child_grants = mergeShowcaseRows(db.child_grants, [
    {
      id: 1,
      proposer_account_id: ACCOUNT_ID,
      target_single_id: 1,
      token_hash:
        "3333333333333333333333333333333333333333333333333333333333333333",
      status: "accepted",
      access_level: "comment",
      expires_at: "2026-12-31T00:00:00.000Z",
      grantee_account_id: 3,
      accepted_at: "2026-07-14T12:00:00.000Z",
      revoked_at: null,
      severed_by_account_id: null,
      severed_at: null,
      copy_on_sever: false,
      created_at: "2026-07-14T12:00:00.000Z",
    },
    {
      id: 2,
      proposer_account_id: ACCOUNT_ID,
      target_single_id: 2,
      token_hash:
        "4444444444444444444444444444444444444444444444444444444444444444",
      status: "revoked",
      access_level: "read",
      expires_at: "2026-09-30T00:00:00.000Z",
      grantee_account_id: null,
      accepted_at: null,
      revoked_at: "2026-07-22T12:00:00.000Z",
      severed_by_account_id: null,
      severed_at: null,
      copy_on_sever: true,
      created_at: "2026-07-21T12:00:00.000Z",
    },
  ]);
  db.trusted_senders = mergeShowcaseRows(db.trusted_senders, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      created_by_member_id: null,
      email: "mrs.feldman@demo.invalid",
      created_at: "2026-07-10T12:00:00.000Z",
    },
    {
      id: 2,
      account_id: 3,
      created_by_member_id: null,
      email: "goldenmatches@demo.invalid",
      created_at: "2026-07-11T12:00:00.000Z",
    },
  ]);

  const taskId = nextId(db.tasks);
  db.tasks = [
    ...db.tasks,
    {
      id: taskId,
      type: "call",
      text: "Call the Feldman family about Dovid Berkowitz",
      due_date: "2026-08-03T14:00:00.000Z",
      done_date: null,
      member_id: HOUSEHOLD_MEMBER_ID,
      account_id: ACCOUNT_ID,
      target_type: "shidduch",
      target_id: 4,
      delivery_channels: ["in_app", "email"],
    },
    {
      id: taskId + 1,
      type: "follow_up",
      text: "Follow up after Rivky's reference call",
      due_date: "2026-08-05T11:00:00.000Z",
      done_date: null,
      member_id: SECOND_MEMBER_ID,
      account_id: ACCOUNT_ID,
      target_type: "single",
      target_id: 1,
      delivery_channels: ["in_app"],
    },
    {
      id: taskId + 2,
      type: "review",
      text: "Review the new Yaakov introductions",
      due_date: "2026-08-06T09:00:00.000Z",
      done_date: "2026-08-01T08:30:00.000Z",
      member_id: HOUSEHOLD_MEMBER_ID,
      account_id: ACCOUNT_ID,
      target_type: "single",
      target_id: 2,
      delivery_channels: ["in_app", "email"],
    },
  ];
  db.task_notifications = mergeShowcaseRows(db.task_notifications, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      task_id: taskId,
      channel: "email",
      due_date: "2026-08-03T14:00:00.000Z",
      status: "sent",
      simulated: true,
      sent_at: "2026-08-03T14:01:00.000Z",
      created_at: "2026-08-03T14:00:00.000Z",
    },
  ]);

  db.inbox_items = mergeShowcaseRows(db.inbox_items, [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      created_at: "2026-07-20T10:12:00.000Z",
      source: "whatsapp",
      sender: "Mrs. Feldman",
      sender_email: "mrs.feldman@demo.invalid",
      sender_needs_confirmation: false,
      raw_text:
        "I have a wonderful boy for Rivky — Dovid Berkowitz, learning in BMG. Should I send the resume?",
      subject: null,
      attachments: null,
      status: "unresolved",
      single_id: 1,
      shadchan_id: 4,
      resolved_shidduchim_id: null,
      connection_id: null,
      resolution_attempt_id: null,
      resolution_input: null,
    },
    {
      id: 2,
      account_id: ACCOUNT_ID,
      created_at: "2026-07-21T16:40:00.000Z",
      source: "email",
      sender: "Mrs. Gold",
      sender_email: "goldenmatches@demo.invalid",
      sender_needs_confirmation: false,
      subject: "A suggestion for Yaakov",
      raw_text:
        "Attached is a resume for Miriam Kaplan from Monsey. Please call to discuss.",
      attachments: [
        {
          title: "Miriam Kaplan resume.pdf",
          type: "application/pdf",
          path: "inbox/showcase/miriam-kaplan-resume.pdf",
          src: pdfDataUrl("resumes/miriam-kaplan.pdf"),
        },
      ],
      status: "resolved",
      single_id: 2,
      shadchan_id: 1,
      resolved_shidduchim_id: 20,
      connection_id: null,
      resolution_attempt_id: null,
      resolution_input: null,
    },
    {
      id: 3,
      account_id: ACCOUNT_ID,
      created_at: "2026-07-22T09:15:00.000Z",
      source: "email",
      sender: null,
      sender_email: "forwarded@example.com",
      sender_needs_confirmation: true,
      subject: "Fwd: suggestion",
      raw_text:
        "See attached resume for a thoughtful young woman in Baltimore.",
      attachments: [
        {
          title: "candidate-resume.pdf",
          type: "application/pdf",
          path: "inbox/showcase/candidate-resume.pdf",
          src: pdfDataUrl("resumes/leah-steinberg.pdf"),
        },
      ],
      status: "held",
      single_id: null,
      shadchan_id: null,
      resolved_shidduchim_id: null,
      connection_id: null,
      resolution_attempt_id: null,
      resolution_input: null,
    },
    {
      id: 4,
      account_id: ACCOUNT_ID,
      created_at: "2026-07-23T08:05:00.000Z",
      source: "email",
      sender: "Mrs. Feldman",
      sender_email: "mrs.feldman@demo.invalid",
      sender_needs_confirmation: false,
      subject: "A possible shidduch",
      raw_text:
        "Thank you for considering this. We decided not to move forward at this time.",
      attachments: null,
      status: "dismissed",
      single_id: 1,
      shadchan_id: 4,
      resolved_shidduchim_id: null,
      connection_id: null,
      resolution_attempt_id: null,
      resolution_input: null,
    },
    {
      id: 5,
      account_id: ACCOUNT_ID,
      created_at: "2026-07-24T13:25:00.000Z",
      source: "upload",
      sender: "Klein family archive",
      sender_email: "archive@demo.invalid",
      sender_needs_confirmation: false,
      subject: "Resume upload awaiting confirmation",
      raw_text:
        "A resume was uploaded from the family archive and is ready to review.",
      attachments: [
        {
          title: "Tamar Weiss resume.pdf",
          type: "application/pdf",
          path: "inbox/showcase/tamar-weiss-resume.pdf",
          src: pdfDataUrl("resumes/tamar-weiss.pdf"),
        },
      ],
      status: "resolving",
      single_id: 2,
      shadchan_id: 4,
      resolved_shidduchim_id: null,
      connection_id: null,
      resolution_attempt_id: "showcase-resolution-5",
      resolution_input: {
        action: "new",
        input: {
          single_id: 2,
          shadchan_id: 4,
          name_en: "Tamar Weiss",
          name_he: null,
          father_en: "Yosef Weiss",
          father_he: null,
          mother_en: "Miriam Weiss",
          mother_he: null,
          seminary_en: "Bnos Binah",
          seminary_he: null,
          shul_en: null,
          shul_he: null,
          location_en: "Lakewood, NJ",
          location_he: null,
          age: 22,
          height: "5'4\"",
          dob: null,
          background:
            "Thoughtful, creative, and community-minded; warm with family and friends.",
          marital_status: "single",
          existing_children_note: null,
          origin: "channel",
          initial_state: "new",
          visibility: "shared",
          redt_date: "2026-07-24",
        },
      },
    },
  ]);
}

export function applyShowcaseOverlay(
  base: Db,
  generatedAt: Date = new Date(),
): Db {
  const db = cloneDb(base);
  db.accounts = db.accounts.map((account) => ({
    ...account,
    ...(Number(account.id) === 1
      ? { name: "The Klein Family" }
      : Number(account.id) === 2
        ? { name: "Feldman Shidduch Office" }
        : Number(account.id) === 3
          ? { name: "The Gross Family" }
          : {}),
    demo_bundle_context: true,
  }));
  if (
    db.accounts.some((account) => Number(account.id) === 3) &&
    !db.account_members.some(
      (membership) =>
        Number(membership.account_id) === 3 &&
        membership.user_id === "0" &&
        membership.status === "active",
    )
  ) {
    db.account_members = [
      ...db.account_members,
      {
        id: nextId(db.account_members),
        account_id: 3,
        user_id: "0",
        role: "parent_admin",
        status: "active",
        created_at: SHOWCASE_DATE,
      },
    ];
  }
  db.members = db.members.map((member) =>
    stableMemberDetails[Number(member.id)]
      ? { ...member, ...stableMemberDetails[Number(member.id)] }
      : member,
  );
  normalizeExistingDates(db);
  addShowcaseSuggestions(db);
  seedShowcaseProfileAssets(db);
  seedShowcaseCollections(db);
  makeShowcaseDatesDynamic(db, generatedAt);
  return db;
}

export function generateShowcaseData(generatedAt: Date = new Date()): Db {
  return applyShowcaseOverlay(generateData(), generatedAt);
}

import type {
  Account,
  AccountMember,
  Child,
  DateRecord,
  Redt,
  Resume,
  Shadchan,
  Shidduch,
  ShidduchSchool,
} from "../../../types";
import { PIPELINE_TRANSITIONS } from "../../../shidduchim/pipelineStates";
import type { Db } from "./types";

// Seed data mirrors design-artifacts/reference-board-after.html so the demo
// board matches the mockup. Per the build brief we DO NOT fabricate catch-chip
// (dedupe) data — the card catch slot stays empty until real matchIdentity()
// output exists (Epic-4).

const ACCOUNT_ID = 1;

const shadchanimSeed: Shadchan[] = [
  {
    id: 1,
    account_id: ACCOUNT_ID,
    name: "Mrs. Gold",
    name_he: "מרת גולד",
    location: "Baltimore, MD",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    account_id: ACCOUNT_ID,
    name: "Mrs. D. Klein",
    name_he: "מרת קליין",
    location: "Brooklyn, NY",
    responsiveness: "medium",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 3,
    account_id: ACCOUNT_ID,
    name: "Mrs. Weiss",
    name_he: "מרת וייס",
    location: "Lakewood, NJ",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 4,
    account_id: ACCOUNT_ID,
    name: "Mrs. Feldman",
    name_he: "מרת פלדמן",
    location: "Lakewood, NJ",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const childrenSeed: Child[] = [
  {
    id: 1,
    account_id: ACCOUNT_ID,
    first_name_en: "Rivky",
    first_name_he: "רבקה",
    last_name_en: "Klein",
    last_name_he: "קליין",
    gender: "female",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    account_id: ACCOUNT_ID,
    first_name_en: "Yaakov",
    first_name_he: "יעקב",
    last_name_en: "Klein",
    last_name_he: "קליין",
    gender: "male",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

type Seed = {
  child_id: number;
  shadchan_id: number;
  name_en: string;
  name_he: string;
  location_en: string;
  seminary_en: string;
  redt_date: string;
  pipeline_state: Shidduch["pipeline_state"];
};

// Rivky's pipeline (matches the reference mockup, all 7 states populated).
const rivkySeeds: Seed[] = [
  {
    child_id: 1,
    shadchan_id: 1,
    name_en: "Ari Rosenberg",
    name_he: "אריה רוזנברג",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-07-20",
    pipeline_state: "new",
  },
  {
    child_id: 1,
    shadchan_id: 2,
    name_en: "Menachem Stern",
    name_he: "מנחם שטרן",
    location_en: "Brooklyn, NY",
    seminary_en: "Chaim Berlin",
    redt_date: "2026-07-19",
    pipeline_state: "new",
  },
  {
    child_id: 1,
    shadchan_id: 3,
    name_en: "Boruch Sofer",
    name_he: "ברוך סופר",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-19",
    pipeline_state: "new",
  },
  {
    child_id: 1,
    shadchan_id: 4,
    name_en: "Dovid Berkowitz",
    name_he: "דוד ברקוביץ",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-18",
    pipeline_state: "look_into",
  },
  {
    child_id: 1,
    shadchan_id: 3,
    name_en: "Shmuli Katz",
    name_he: "שמואל כ״ץ",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-14",
    pipeline_state: "look_into",
  },
  {
    child_id: 1,
    shadchan_id: 4,
    name_en: "Yisroel Fried",
    name_he: "ישראל פריד",
    location_en: "Cleveland, OH",
    seminary_en: "Telshe",
    redt_date: "2026-07-09",
    pipeline_state: "look_into",
  },
  {
    child_id: 1,
    shadchan_id: 3,
    name_en: "Yehuda Klein",
    name_he: "יהודה קליין",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-12",
    pipeline_state: "not_sure",
  },
  {
    child_id: 1,
    shadchan_id: 1,
    name_en: "Moshe Diamond",
    name_he: "משה דיאמונד",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-07",
    pipeline_state: "not_sure",
  },
  {
    child_id: 1,
    shadchan_id: 4,
    name_en: "Eli Traube",
    name_he: "אלי טרויבה",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-04-14",
    pipeline_state: "for_sure_not",
  },
  {
    child_id: 1,
    shadchan_id: 1,
    name_en: "Chaim Landau",
    name_he: "חיים לנדא",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-02",
    pipeline_state: "yes",
  },
  {
    child_id: 1,
    shadchan_id: 3,
    name_en: "Yosef Gross",
    name_he: "יוסף גרוס",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-06-28",
    pipeline_state: "yes",
  },
  {
    child_id: 1,
    shadchan_id: 2,
    name_en: "Tzvi Adler",
    name_he: "צבי אדלר",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-06-28",
    pipeline_state: "unsure",
  },
  {
    child_id: 1,
    shadchan_id: 4,
    name_en: "Naftali Berger",
    name_he: "נפתלי ברגר",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-04-09",
    pipeline_state: "no",
  },
];

// A smaller pipeline for Yaakov, so the per-child isolation (FR50) is
// visible when switching children.
const yaakovSeeds: Seed[] = [
  {
    child_id: 2,
    shadchan_id: 2,
    name_en: "Leah Steinberg",
    name_he: "לאה שטיינברג",
    location_en: "Passaic, NJ",
    seminary_en: "Bnos Chava",
    redt_date: "2026-07-17",
    pipeline_state: "new",
  },
  {
    child_id: 2,
    shadchan_id: 1,
    name_en: "Miriam Roth",
    name_he: "מרים רוט",
    location_en: "Baltimore, MD",
    seminary_en: "Bais Yaakov",
    redt_date: "2026-07-11",
    pipeline_state: "look_into",
  },
  {
    child_id: 2,
    shadchan_id: 3,
    name_en: "Sara Weinberg",
    name_he: "שרה ווינברג",
    location_en: "Lakewood, NJ",
    seminary_en: "Bnos Devorah",
    redt_date: "2026-06-30",
    pipeline_state: "yes",
  },
];

export const generateShidduchimDomain = (db: Db) => {
  const accounts: Account[] = [
    {
      id: ACCOUNT_ID,
      name: "Klein Family",
      transparency_level: "shared",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  const account_members: AccountMember[] = [];

  const allSeeds = [...rivkySeeds, ...yaakovSeeds];
  const shidduchim: Shidduch[] = allSeeds.map((seed, i) => ({
    id: i + 1,
    account_id: ACCOUNT_ID,
    child_id: seed.child_id,
    shadchan_id: seed.shadchan_id,
    name_en: seed.name_en,
    name_he: seed.name_he,
    parents_en: null,
    parents_he: null,
    seminary_en: seed.seminary_en,
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: seed.location_en,
    location_he: null,
    age: null,
    height: null,
    pipeline_state: seed.pipeline_state,
    first_suggested_by: seed.shadchan_id,
    first_suggested_at: `${seed.redt_date}T00:00:00.000Z`,
    redt_date: seed.redt_date,
    close_reason: null,
    origin: "manual",
    owner_member_id: null,
    visibility: "shared",
    index: 0,
    created_at: `${seed.redt_date}T00:00:00.000Z`,
  }));

  // Per-child, per-state board ordering (mirrors generateDeals()).
  [1, 2].forEach((childId) => {
    const states = new Set(shidduchim.map((s) => s.pipeline_state));
    states.forEach((state) => {
      shidduchim
        .filter((s) => s.child_id === childId && s.pipeline_state === state)
        .forEach((s, index) => {
          s.index = index;
        });
    });
  });

  // Redt history: one redt per shidduch (the original), plus a few EARLIER
  // redts on two shidduchim to show a single redt by the same shadchan again
  // and by a different shadchan — "redt by the same or multiple people".
  let redtId = 1;
  const redts: Redt[] = shidduchim.map((s) => ({
    id: redtId++,
    account_id: ACCOUNT_ID,
    shidduchim_id: s.id,
    shadchan_id: s.shadchan_id,
    redt_date: s.redt_date,
    note: null,
    created_at: `${s.redt_date}T00:00:00.000Z`,
  }));
  const extraRedts: Array<
    Pick<Redt, "shidduchim_id" | "shadchan_id" | "redt_date">
  > = [
    { shidduchim_id: 4, shadchan_id: 4, redt_date: "2026-04-18" }, // Mrs. Feldman, again
    { shidduchim_id: 4, shadchan_id: 1, redt_date: "2026-03-02" }, // Mrs. Gold, too
    { shidduchim_id: 5, shadchan_id: 3, redt_date: "2026-05-20" }, // Mrs. Weiss, again
  ];
  extraRedts.forEach((r) => {
    redts.push({
      id: redtId++,
      account_id: ACCOUNT_ID,
      shidduchim_id: r.shidduchim_id,
      shadchan_id: r.shadchan_id,
      redt_date: r.redt_date,
      note: null,
      created_at: `${r.redt_date}T00:00:00.000Z`,
    });
  });

  // Recompute each shidduch's redt summary from its history (mirror the trigger):
  // redt_date = latest, shadchan_id = latest redt's shadchan, first_suggested = earliest.
  shidduchim.forEach((s) => {
    const own = redts
      .filter((r) => r.shidduchim_id === s.id)
      .sort(
        (a, b) =>
          a.redt_date.localeCompare(b.redt_date) || Number(a.id) - Number(b.id),
      );
    if (own.length === 0) return;
    const first = own[0];
    const last = own[own.length - 1];
    s.redt_date = last.redt_date;
    s.shadchan_id = last.shadchan_id ?? null;
    s.first_suggested_by = first.shadchan_id ?? null;
    s.first_suggested_at = `${first.redt_date}T00:00:00.000Z`;
  });

  // Education history: each shidduch's seminary/yeshiva as its first school
  // (kind = opposite of the child's gender), plus an extra school with years on
  // one shidduch to show multiple institutions.
  const childGenderById = new Map(childrenSeed.map((c) => [c.id, c.gender]));
  let schoolId = 1;
  const shidduchSchools: ShidduchSchool[] = shidduchim
    .filter((s) => s.seminary_en)
    .map((s) => ({
      id: schoolId++,
      account_id: ACCOUNT_ID,
      shidduchim_id: s.id,
      kind: childGenderById.get(s.child_id) === "male" ? "seminary" : "yeshiva",
      name_en: s.seminary_en ?? null,
      name_he: null,
      start_year: null,
      end_year: null,
      created_at: s.created_at,
    }));
  shidduchSchools.push({
    id: schoolId++,
    account_id: ACCOUNT_ID,
    shidduchim_id: 4, // Dovid Berkowitz — also attended a mesivta (with years)
    kind: "school",
    name_en: "Mesivta of Lakewood",
    name_he: null,
    start_year: 2018,
    end_year: 2022,
    created_at: "2026-01-01T00:00:00.000Z",
  });

  db.accounts = accounts;
  db.account_members = account_members;
  db.children = childrenSeed;
  db.shadchanim = shadchanimSeed;
  db.shidduchim = shidduchim;
  db.resumes = [] as Resume[];
  // db.references / db.reference_links / db.interactions are seeded by
  // generateReferencesDomain() (references.ts), which runs after this module
  // so it can point reference_links.shidduchim_id at real shidduchim ids.
  db.date_records = [] as DateRecord[];
  db.redts = redts;
  db.shidduch_schools = shidduchSchools;
  db.pipeline_transitions = PIPELINE_TRANSITIONS.map((t) => ({ ...t }));
};

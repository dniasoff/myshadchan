import type {
  Account,
  AccountMember,
  Connection,
  DateRecord,
  MedicalNote,
  Redt,
  Resume,
  ResumePhoto,
  Shadchan,
  Shidduch,
  ShidduchExternalLink,
  ShidduchSchool,
  Single,
} from "../../../types";
import { PIPELINE_TRANSITIONS } from "../../../shidduchim/pipelineStates";
import type { Db } from "./types";

// Seed data mirrors design-artifacts/reference-board-after.html so the demo
// board matches the mockup. Per the build brief we DO NOT fabricate catch-chip
// (dedupe) data — the card catch slot stays empty until real matchIdentity()
// output exists (Epic-4).

const ACCOUNT_ID = 1;

// Story 7.4 (Task 6): a shadchanus account and an ACCEPTED connection to the
// household above, seeded directly — `connections` has no client write path
// at all (7.1 AC-6; Epic 8's consent workflow is the only future writer), so
// this is the ONLY way the demo build can ever show a connection-scoped
// thread before Epic 8 ships that workflow. No account_member links a demo
// login to this account: nothing in Epic 7 builds a Connection 360 or a
// context-switcher entry for it (this story's own "surface honesty" note —
// see the story file's Dev Notes), so this seed exists purely so
// `createThread()`/`thread_is_readable()`'s FakeRest mirrors have a real
// connection to exercise, exactly like `dataProvider.createThread.test.ts`
// and its Story 7.4 sibling do.
const SHADCHANUS_ACCOUNT_ID = 2;

// Story 8.5 (Task 7): a second, connection-only household — no singles/
// shidduchim of its own, exactly like SHADCHANUS_ACCOUNT_ID's own posture
// above (it exists purely so the Connections list has more than one row to
// show in demo mode). No account_member links a demo login to it either;
// only its NAME is ever shown, denormalized onto the connection row below.
const SECOND_HOUSEHOLD_ACCOUNT_ID = 3;

const shadchanimSeed: Shadchan[] = [
  {
    id: 1,
    account_id: ACCOUNT_ID,
    name: "Mrs. Gold",
    name_he: null,
    location: "Baltimore, MD",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    account_id: ACCOUNT_ID,
    name: "Mrs. D. Klein",
    name_he: null,
    location: "Brooklyn, NY",
    responsiveness: "medium",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 3,
    account_id: ACCOUNT_ID,
    name: "Mrs. Weiss",
    name_he: null,
    location: "Lakewood, NJ",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 4,
    account_id: ACCOUNT_ID,
    name: "Mrs. Feldman",
    name_he: null,
    location: "Lakewood, NJ",
    responsiveness: "high",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const singlesSeed: Single[] = [
  {
    id: 1,
    account_id: ACCOUNT_ID,
    first_name_en: "Rivky",
    first_name_he: null,
    last_name_en: "Klein",
    last_name_he: null,
    gender: "female",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    account_id: ACCOUNT_ID,
    first_name_en: "Yaakov",
    first_name_he: null,
    last_name_en: "Klein",
    last_name_he: null,
    gender: "male",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

type Seed = {
  single_id: number;
  shadchan_id: number;
  name_en: string;
  location_en: string;
  seminary_en: string;
  redt_date: string;
  pipeline_state: Shidduch["pipeline_state"];
};

// Rivky's pipeline (matches the reference mockup, all 7 states populated).
const rivkySeeds: Seed[] = [
  {
    single_id: 1,
    shadchan_id: 1,
    name_en: "Ari Rosenberg",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-07-20",
    pipeline_state: "new",
  },
  {
    single_id: 1,
    shadchan_id: 2,
    name_en: "Menachem Stern",
    location_en: "Brooklyn, NY",
    seminary_en: "Chaim Berlin",
    redt_date: "2026-07-19",
    pipeline_state: "new",
  },
  {
    single_id: 1,
    shadchan_id: 3,
    name_en: "Boruch Sofer",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-19",
    pipeline_state: "new",
  },
  {
    single_id: 1,
    shadchan_id: 4,
    name_en: "Dovid Berkowitz",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-18",
    pipeline_state: "look_into",
  },
  {
    single_id: 1,
    shadchan_id: 3,
    name_en: "Shmuli Katz",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-14",
    pipeline_state: "look_into",
  },
  {
    single_id: 1,
    shadchan_id: 4,
    name_en: "Yisroel Fried",
    location_en: "Cleveland, OH",
    seminary_en: "Telshe",
    redt_date: "2026-07-09",
    pipeline_state: "look_into",
  },
  {
    single_id: 1,
    shadchan_id: 3,
    name_en: "Yehuda Klein",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-07-12",
    pipeline_state: "not_sure",
  },
  {
    single_id: 1,
    shadchan_id: 1,
    name_en: "Moshe Diamond",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-07",
    pipeline_state: "not_sure",
  },
  {
    single_id: 1,
    shadchan_id: 4,
    name_en: "Eli Traube",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-04-14",
    pipeline_state: "for_sure_not",
  },
  {
    single_id: 1,
    shadchan_id: 1,
    name_en: "Chaim Landau",
    location_en: "Monsey, NY",
    seminary_en: "Mir",
    redt_date: "2026-07-02",
    pipeline_state: "yes",
  },
  {
    single_id: 1,
    shadchan_id: 3,
    name_en: "Yosef Gross",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-06-28",
    pipeline_state: "yes",
  },
  {
    single_id: 1,
    shadchan_id: 2,
    name_en: "Tzvi Adler",
    location_en: "Baltimore, MD",
    seminary_en: "Ner Yisroel",
    redt_date: "2026-06-28",
    pipeline_state: "unsure",
  },
  {
    single_id: 1,
    shadchan_id: 4,
    name_en: "Naftali Berger",
    location_en: "Lakewood, NJ",
    seminary_en: "BMG",
    redt_date: "2026-04-09",
    pipeline_state: "no",
  },
];

// A smaller pipeline for Yaakov, so the per-single isolation (FR50) is
// visible when switching singles.
const yaakovSeeds: Seed[] = [
  {
    single_id: 2,
    shadchan_id: 2,
    name_en: "Leah Steinberg",
    location_en: "Passaic, NJ",
    seminary_en: "Bnos Chava",
    redt_date: "2026-07-17",
    pipeline_state: "new",
  },
  {
    single_id: 2,
    shadchan_id: 1,
    name_en: "Miriam Roth",
    location_en: "Baltimore, MD",
    seminary_en: "Bais Yaakov",
    redt_date: "2026-07-11",
    pipeline_state: "look_into",
  },
  {
    single_id: 2,
    shadchan_id: 3,
    name_en: "Sara Weinberg",
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
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    // Story 7.4 (Task 6): see SHADCHANUS_ACCOUNT_ID's own comment above.
    {
      id: SHADCHANUS_ACCOUNT_ID,
      name: "Golden Matches Shadchanus",
      transparency_level: "shared",
      kind: "shadchanus",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    // Story 8.5 (Task 7): see SECOND_HOUSEHOLD_ACCOUNT_ID's own comment above.
    {
      id: SECOND_HOUSEHOLD_ACCOUNT_ID,
      name: "Feldman Family",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-05T00:00:00.000Z",
    },
  ];

  // Story 7.4 (Task 6) / Story 8.5 (Task 7): the demo build's connections —
  // see SHADCHANUS_ACCOUNT_ID's own comment for why the seeded rows carry
  // no login of their own on the shadchanus side. A second connection (to
  // SECOND_HOUSEHOLD_ACCOUNT_ID) gives the Connections list ("a handful",
  // Task 7) more than one row to show.
  const connections: Connection[] = [
    {
      id: 1,
      household_account_id: ACCOUNT_ID,
      shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
      status: "accepted",
      ended_at: null,
      // Story 8.2: an arbitrary-but-valid choice — the demo build never
      // exercises who proposed this seeded connection, only that it exists.
      proposed_by_account_id: ACCOUNT_ID,
      accepted_at: "2026-01-01T00:00:00.000Z",
      ended_by_account_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      household_account_name: "Klein Family",
    },
    {
      id: 2,
      household_account_id: SECOND_HOUSEHOLD_ACCOUNT_ID,
      shadchanus_account_id: SHADCHANUS_ACCOUNT_ID,
      status: "accepted",
      ended_at: null,
      proposed_by_account_id: SECOND_HOUSEHOLD_ACCOUNT_ID,
      accepted_at: "2026-01-05T00:00:00.000Z",
      ended_by_account_id: null,
      created_at: "2026-01-05T00:00:00.000Z",
      household_account_name: "Feldman Family",
    },
  ];

  // Story 8.5 (Task 7): NOT seeding a connection-scoped thread here, unlike
  // the two connections above. `db.threads`/`thread_participants`/`messages`
  // are the shared fixture base for many unrelated component tests across
  // the codebase (any test that calls the real `generateData()` rather than
  // building its own minimal `db`), which assert exact counts/ids against
  // them (`ThreadList.test.tsx`, `ShidduchDiscussionsTab.test.tsx`, …) —
  // proven live: adding one demo thread here made three unrelated
  // `createThread()` assertions fail on `toHaveLength(1)`, now `2`. The
  // existing "seeded empty" convention for these three tables
  // (`dataGenerator/types.ts`'s own comment) stays as-is; the Connection
  // 360's discussions tab is still fully demoable by starting a discussion
  // from the UI itself (`ThreadList`'s own "Start a discussion" button),
  // exactly like every other subject's discussions tab in the demo build.

  // The default demo login ("Jane Doe", member id 0 — fakerest/authProvider.ts)
  // holds the `parent` persona on the seeded Klein household. Without this,
  // `getMyPersonas()` (2.3 AC-8/AC-9) reports zero personas for the default
  // login and `OnboardingGate` would show the persona multi-select on every
  // `make start-demo` boot instead of the seeded board.
  //
  // Story 8.5 (Task 7): the SAME login also holds a `shadchan` membership on
  // SHADCHANUS_ACCOUNT_ID, so the shadchanus context (dashboard,
  // Connections list/360) is reachable in demo mode via the context
  // switcher — without this, Story 7.4's own seeded connection had no login
  // able to view either side of it at all. `activate_first_context_trigger`
  // is a real-database mechanism this static seed does not run; FakeRest's
  // own `getMyContexts()` mirror instead treats the FIRST membership row
  // (by id) as active until `set_active_context()` is called
  // (`internal/contexts.ts`), so this second row does not change which
  // context the demo boots into.
  const account_members: AccountMember[] = [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      account_id: SHADCHANUS_ACCOUNT_ID,
      user_id: "0",
      role: "shadchan",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  const allSeeds = [...rivkySeeds, ...yaakovSeeds];
  const shidduchim: Shidduch[] = allSeeds.map((seed, i) => ({
    id: i + 1,
    account_id: ACCOUNT_ID,
    single_id: seed.single_id,
    shadchan_id: seed.shadchan_id,
    name_en: seed.name_en,
    name_he: null,
    father_en: null,
    father_he: null,
    mother_en: null,
    mother_he: null,
    seminary_en: seed.seminary_en,
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: seed.location_en,
    location_he: null,
    age: null,
    height: null,
    dob: null,
    background: null,
    marital_status: null,
    existing_children_note: null,
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

  // Per-single, per-state board ordering.
  [1, 2].forEach((singleId) => {
    const states = new Set(shidduchim.map((s) => s.pipeline_state));
    states.forEach((state) => {
      shidduchim
        .filter((s) => s.single_id === singleId && s.pipeline_state === state)
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
  // (kind = opposite of the single's gender), plus an extra school with years on
  // one shidduch to show multiple institutions.
  const singleGenderById = new Map(singlesSeed.map((c) => [c.id, c.gender]));
  let schoolId = 1;
  const shidduchSchools: ShidduchSchool[] = shidduchim
    .filter((s) => s.seminary_en)
    .map((s) => ({
      id: schoolId++,
      account_id: ACCOUNT_ID,
      shidduchim_id: s.id,
      kind:
        singleGenderById.get(s.single_id) === "male" ? "seminary" : "yeshiva",
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
  db.connections = connections;
  db.account_members = account_members;
  db.singles = singlesSeed;
  db.shadchanim = shadchanimSeed;
  db.shidduchim = shidduchim;
  db.resumes = [] as Resume[];
  db.resume_photos = [] as ResumePhoto[];
  // Medical tab (Story 5.5) — seeded empty, same reasoning as resume_photos
  // above: the demo build must not crash on this tab.
  db.medical_notes = [] as MedicalNote[];
  // External links tab (Story 5.6) — seeded empty, same reasoning as
  // medical_notes above.
  db.shidduchim_external_links = [] as ShidduchExternalLink[];
  // db.references / db.reference_links / db.interactions are seeded by
  // generateReferencesDomain() (references.ts), which runs after this module
  // so it can point reference_links.shidduchim_id at real shidduchim ids.
  db.date_records = [] as DateRecord[];
  db.redts = redts;
  db.shidduch_schools = shidduchSchools;
  db.pipeline_transitions = PIPELINE_TRANSITIONS.map((t) => ({ ...t }));
};

import type { AssetKey } from "../seed_demo/assets/manifest.ts";

// The curated realistic demo dataset (Stage A of onboarding). English-only,
// frum/yeshivish household — the Kleins. See
// design-artifacts/demo-onboarding-plan.md §5 for the full rationale.
//
// redt/task dates are expressed as day offsets from "now" and resolved to ISO
// strings at seed time (daysAgo/daysFromNow below), so the demo always looks
// current no matter when it is seeded.

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export function daysFromNowIso(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

export type DemoSingle = {
  first_name_en: string;
  last_name_en: string;
  gender: "male" | "female";
  dob: string;
  community: string;
  status: string;
};

export type DemoSinglePrivateContent = {
  singleKey: "Rivky" | "Yaakov";
  body: string;
  visibleToManager: boolean;
};

export const SINGLES: DemoSingle[] = [
  {
    first_name_en: "Rivky",
    last_name_en: "Klein",
    gender: "female",
    dob: "2002-04-18",
    community: "Baltimore",
    status: "active",
  },
  {
    first_name_en: "Yaakov",
    last_name_en: "Klein",
    gender: "male",
    dob: "1998-09-02",
    community: "Lakewood",
    status: "active",
  },
];

// These are deliberately private-content fixtures rather than public profile
// fields.  They mirror the FakeRest showcase and are inserted through the
// guarded seed path so manager visibility remains a real authorization rule.
export const SINGLE_PREFERENCES: DemoSinglePrivateContent[] = [
  {
    singleKey: "Rivky",
    body: "Looking for a warm, growth-oriented ben Torah with strong middos.",
    visibleToManager: true,
  },
  {
    singleKey: "Yaakov",
    body: "Hoping to meet someone kind, grounded, and family-oriented.",
    visibleToManager: false,
  },
];

export const SINGLE_NOTES: DemoSinglePrivateContent[] = [
  {
    singleKey: "Rivky",
    body: "Rivky prefers a calm, collaborative shidduch process.",
    visibleToManager: false,
  },
  {
    singleKey: "Yaakov",
    body: "Yaakov is comfortable with an introduction through the Feldman office.",
    visibleToManager: true,
  },
];

export type DemoShadchan = {
  key: string;
  name: string;
  location: string;
  contacts: { phone: string };
  responsiveness: "high" | "medium" | "low";
};

export const SHADCHANIM: DemoShadchan[] = [
  {
    key: "S1",
    name: "Mrs. Leah Feldman",
    location: "Lakewood, NJ",
    contacts: { phone: "732-555-0101" },
    responsiveness: "high",
  },
  {
    key: "S2",
    name: "Rabbi Shmuel Weiss",
    location: "Lakewood, NJ",
    contacts: { phone: "732-555-0102" },
    responsiveness: "medium",
  },
  {
    key: "S3",
    name: "Mrs. Chaya Rosenberg",
    location: "Monsey, NY",
    contacts: { phone: "845-555-0103" },
    responsiveness: "high",
  },
  {
    key: "S4",
    name: "Mrs. Sarah Greenberg",
    location: "Brooklyn, NY",
    contacts: { phone: "718-555-0104" },
    responsiveness: "low",
  },
  {
    key: "S5",
    name: "Rabbi Yosef Kanarek",
    location: "Passaic, NJ",
    contacts: { phone: "973-555-0105" },
    responsiveness: "medium",
  },
];

export type DemoReference = {
  key: string;
  name_en: string;
  relationship: string;
  phone: string;
  school?: string;
};

export const REFERENCES: DemoReference[] = [
  {
    key: "R1",
    name_en: "Rabbi Avrohom Stein",
    relationship: "Rebbe (BMG)",
    phone: "732-555-0142",
    school: "Beth Medrash Govoha",
  },
  {
    key: "R2",
    name_en: "Mrs. Devora Klein",
    relationship: "Seminary teacher",
    phone: "845-555-0177",
    school: "Bais Yaakov of Lakewood",
  },
  {
    key: "R3",
    name_en: "Mrs. Shaindy Berger",
    relationship: "Neighbor",
    phone: "732-555-0198",
  },
  {
    key: "R4",
    name_en: "Yaakov Lerner",
    relationship: "Chavrusa / friend",
    phone: "718-555-0165",
    school: "Beth Medrash Govoha",
  },
];

export type PipelineState =
  "new" | "look_into" | "not_sure" | "for_sure_not" | "yes" | "unsure" | "no";

export type DemoSuggestion = {
  key: string;
  name_en: string;
  father_en: string;
  mother_en: string;
  // The suggestion's own school: a boy's yeshiva/beis medrash when suggested
  // to the girl, or a girl's seminary when suggested to the boy.
  seminary_en: string;
  location_en: string;
  age: number;
  height: string;
  sex: "female" | "male";
  shadchanKey: string;
  redtDaysAgo: number;
  targetState: PipelineState;
  closeReason?: string;
};

// Rivky's pipeline (single = woman) — 13 men across all seven states.
export const RIVKY_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "AriRosenberg",
    name_en: "Ari Rosenberg",
    father_en: "Michael Rosenberg",
    mother_en: "Sarah Rosenberg",
    seminary_en: "Ner Yisroel",
    location_en: "Baltimore, MD",
    age: 25,
    height: "5'11\"",
    sex: "male",
    shadchanKey: "S1",
    redtDaysAgo: 32,
    targetState: "new",
  },
  {
    key: "MenachemStern",
    name_en: "Menachem Stern",
    father_en: "David Stern",
    mother_en: "Rachel Stern",
    seminary_en: "Chaim Berlin",
    location_en: "Brooklyn, NY",
    age: 26,
    height: "6'0\"",
    sex: "male",
    shadchanKey: "S2",
    redtDaysAgo: 33,
    targetState: "new",
  },
  {
    key: "BoruchSofer",
    name_en: "Boruch Sofer",
    father_en: "Moshe Sofer",
    mother_en: "Leah Sofer",
    seminary_en: "Beth Medrash Govoha",
    location_en: "Lakewood, NJ",
    age: 24,
    height: "5'10\"",
    sex: "male",
    shadchanKey: "S3",
    redtDaysAgo: 33,
    targetState: "new",
  },
  {
    key: "DovidBerkowitz",
    name_en: "Dovid Berkowitz",
    father_en: "Yitzchok Berkowitz",
    mother_en: "Chana Berkowitz",
    seminary_en: "Beth Medrash Govoha",
    location_en: "Lakewood, NJ",
    age: 25,
    height: "5'9\"",
    sex: "male",
    shadchanKey: "S4",
    redtDaysAgo: 34,
    targetState: "look_into",
  },
  {
    key: "ShmuliKatz",
    name_en: "Shmuli Katz",
    father_en: "Avi Katz",
    mother_en: "Miriam Katz",
    seminary_en: "Mir Yerushalayim",
    location_en: "Monsey, NY",
    age: 27,
    height: "6'1\"",
    sex: "male",
    shadchanKey: "S3",
    redtDaysAgo: 38,
    targetState: "look_into",
  },
  {
    key: "YisroelFried",
    name_en: "Yisroel Fried",
    father_en: "Eli Fried",
    mother_en: "Tova Fried",
    seminary_en: "Telshe Yeshiva",
    location_en: "Cleveland, OH",
    age: 25,
    height: "5'10\"",
    sex: "male",
    shadchanKey: "S4",
    redtDaysAgo: 43,
    targetState: "look_into",
  },
  {
    key: "YehudaKlein",
    name_en: "Yehuda Klein",
    father_en: "Yehuda Klein",
    mother_en: "Rivka Klein",
    seminary_en: "Beth Medrash Govoha",
    location_en: "Lakewood, NJ",
    age: 26,
    height: "5'11\"",
    sex: "male",
    shadchanKey: "S3",
    redtDaysAgo: 40,
    targetState: "not_sure",
  },
  {
    key: "MosheDiamond",
    name_en: "Moshe Diamond",
    father_en: "Shlomo Diamond",
    mother_en: "Esther Diamond",
    seminary_en: "Mir Yerushalayim",
    location_en: "Monsey, NY",
    age: 24,
    height: "5'8\"",
    sex: "male",
    shadchanKey: "S1",
    redtDaysAgo: 45,
    targetState: "not_sure",
  },
  {
    key: "EliTraube",
    name_en: "Eli Traube",
    father_en: "Avrohom Traube",
    mother_en: "Devorah Traube",
    seminary_en: "Ner Yisroel",
    location_en: "Baltimore, MD",
    age: 28,
    height: "6'0\"",
    sex: "male",
    shadchanKey: "S4",
    redtDaysAgo: 129,
    targetState: "for_sure_not",
  },
  {
    key: "ChaimLandau",
    name_en: "Chaim Landau",
    father_en: "Yosef Landau",
    mother_en: "Bracha Landau",
    seminary_en: "Mir Yerushalayim",
    location_en: "Monsey, NY",
    age: 25,
    height: "5'10\"",
    sex: "male",
    shadchanKey: "S1",
    redtDaysAgo: 50,
    targetState: "yes",
  },
  {
    key: "YosefGross",
    name_en: "Yosef Gross",
    father_en: "Mendel Gross",
    mother_en: "Chani Gross",
    seminary_en: "Beth Medrash Govoha",
    location_en: "Lakewood, NJ",
    age: 26,
    height: "5'11\"",
    sex: "male",
    shadchanKey: "S3",
    redtDaysAgo: 54,
    targetState: "yes",
  },
  {
    key: "TzviAdler",
    name_en: "Tzvi Adler",
    father_en: "Yitzchok Adler",
    mother_en: "Rina Adler",
    seminary_en: "Ner Yisroel",
    location_en: "Baltimore, MD",
    age: 24,
    height: "5'9\"",
    sex: "male",
    shadchanKey: "S2",
    redtDaysAgo: 54,
    targetState: "unsure",
  },
  {
    key: "NaftaliBerger",
    name_en: "Naftali Berger",
    father_en: "Shimon Berger",
    mother_en: "Ruth Berger",
    seminary_en: "Beth Medrash Govoha",
    location_en: "Lakewood, NJ",
    age: 27,
    height: "6'1\"",
    sex: "male",
    shadchanKey: "S4",
    redtDaysAgo: 134,
    targetState: "no",
    closeReason: "Different hashkafic direction.",
  },
];

// Yaakov's pipeline (single = man) — 7 women, one in every state.
export const YAAKOV_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "LeahSteinberg",
    name_en: "Leah Steinberg",
    father_en: "Yosef Steinberg",
    mother_en: "Miriam Steinberg",
    seminary_en: "Bnos Chava",
    location_en: "Passaic, NJ",
    age: 23,
    height: "5'4\"",
    sex: "female",
    shadchanKey: "S2",
    redtDaysAgo: 35,
    targetState: "new",
  },
  {
    key: "MiriamRoth",
    name_en: "Miriam Roth",
    father_en: "Daniel Roth",
    mother_en: "Chaya Roth",
    seminary_en: "Bais Yaakov of Baltimore",
    location_en: "Baltimore, MD",
    age: 24,
    height: "5'5\"",
    sex: "female",
    shadchanKey: "S1",
    redtDaysAgo: 41,
    targetState: "look_into",
  },
  {
    key: "SaraWeinberg",
    name_en: "Sara Weinberg",
    father_en: "Yehuda Weinberg",
    mother_en: "Tzipporah Weinberg",
    seminary_en: "Bnos Devorah",
    location_en: "Lakewood, NJ",
    age: 23,
    height: "5'3\"",
    sex: "female",
    shadchanKey: "S3",
    redtDaysAgo: 52,
    targetState: "yes",
  },
  {
    key: "TamarWeiss",
    name_en: "Tamar Weiss",
    father_en: "Yosef Weiss",
    mother_en: "Miriam Weiss",
    seminary_en: "Bnos Binah",
    location_en: "Lakewood, NJ",
    age: 22,
    height: "5'4\"",
    sex: "female",
    shadchanKey: "S4",
    redtDaysAgo: 28,
    targetState: "not_sure",
  },
  {
    key: "AriellaCohen",
    name_en: "Ariella Cohen",
    father_en: "Chaim Cohen",
    mother_en: "Shoshana Cohen",
    seminary_en: "Bnos Chaim",
    location_en: "Passaic, NJ",
    age: 23,
    height: "5'5\"",
    sex: "female",
    shadchanKey: "S2",
    redtDaysAgo: 36,
    targetState: "for_sure_not",
  },
  {
    key: "ChaniLevine",
    name_en: "Chani Levine",
    father_en: "Yitzchok Levine",
    mother_en: "Rochel Levine",
    seminary_en: "Bais Yaakov of the Lower East Side",
    location_en: "Baltimore, MD",
    age: 24,
    height: "5'6\"",
    sex: "female",
    shadchanKey: "S1",
    redtDaysAgo: 39,
    targetState: "unsure",
  },
  {
    key: "MiriamKaplan",
    name_en: "Miriam Kaplan",
    father_en: "Shlomo Kaplan",
    mother_en: "Tova Kaplan",
    seminary_en: "Bnos Sarah",
    location_en: "Monsey, NY",
    age: 25,
    height: "5'4\"",
    sex: "female",
    shadchanKey: "S3",
    redtDaysAgo: 61,
    targetState: "no",
    closeReason: "Timing and location were not aligned.",
  },
];

// Reference diligence: link + call log. suggestionKey must match a
// DemoSuggestion.key from either pipeline above.
export const REFERENCE_LINKS: Array<{
  referenceKey: string;
  suggestionKey: string;
  whatTheySaid: string;
}> = [
  {
    referenceKey: "R1",
    suggestionKey: "ChaimLandau",
    whatTheySaid:
      "Top bochur in his shiur — serious about learning, excellent middos. Well-respected family. Gave a very strong recommendation.",
  },
  {
    referenceKey: "R2",
    suggestionKey: "MiriamRoth",
    whatTheySaid:
      "Knew her well in seminary — mature, responsible, wonderful family. Would be a great fit for a learning boy.",
  },
  {
    referenceKey: "R1",
    suggestionKey: "AriRosenberg",
    whatTheySaid:
      "Knew him from a previous shidduch inquiry. Very solid boy with a warm family. Would be a good match for a Lakewood girl.",
  },
  {
    referenceKey: "R3",
    suggestionKey: "SaraWeinberg",
    whatTheySaid:
      "Neighbor for several years. The family is quiet, ehrliche, and very close. Sara is helpful and mature.",
  },
  {
    referenceKey: "R4",
    suggestionKey: "TzviAdler",
    whatTheySaid:
      "Chavrusa for a full zeman. Tzvi is consistent, has good derech eretz, and takes learning seriously. Recommended warmly.",
  },
  {
    referenceKey: "R2",
    suggestionKey: "LeahSteinberg",
    whatTheySaid:
      "Former teacher. Leah is poised and responsible, with a strong sense of family. Very positive impression.",
  },
];

// Plain timeline notes on suggestions.
export const TIMELINE_NOTES: Array<{ suggestionKey: string; body: string }> = [
  {
    suggestionKey: "ChaimLandau",
    body: "Parents sound very interested. Waiting to hear back after they check into our side. References so far are excellent.",
  },
  {
    suggestionKey: "DovidBerkowitz",
    body: "Redt by Rabbi Weiss — learning in BMG, supposed to be an outstanding bochur. Need to call references this week.",
  },
  {
    suggestionKey: "MiriamRoth",
    body: "Seminary teacher gave a glowing report. Planning to set up a call between the parents.",
  },
  {
    suggestionKey: "SaraWeinberg",
    body: "Parents spoke last night. Both sides are warm and practical; scheduling a second call.",
  },
  {
    suggestionKey: "AriRosenberg",
    body: "Resume looks strong. Shadchan says he is a masmid with excellent middos; checking references.",
  },
  {
    suggestionKey: "TzviAdler",
    body: "Mixed reports from references. Holding off until we can speak directly to the rebbe.",
  },
  {
    suggestionKey: "LeahSteinberg",
    body: "Just redt by Mrs. Rosenberg. Need to review resume and set up parent call.",
  },
  {
    suggestionKey: "NaftaliBerger",
    body: "Closed after one date — different hashkafos. Spoke to shadchan respectfully.",
  },
  {
    suggestionKey: "EliTraube",
    body: "Spoke to references; not the right fit. Will move to for-sure-not.",
  },
  {
    suggestionKey: "MiriamKaplan",
    body: "Date happened last week. Both agreed nicely that ages didn't work out.",
  },
];

// Reminders. target: 'shidduch' -> suggestionKey; 'reference' -> referenceKey.
export const TASKS: Array<{
  text: string;
  type: string;
  dueDaysOffset: number; // negative = overdue
  targetType: "shidduch" | "reference";
  targetKey: string;
}> = [
  {
    text: "Call Mrs. Feldman to follow up on Chaim Landau",
    type: "Call",
    dueDaysOffset: -2,
    targetType: "shidduch",
    targetKey: "ChaimLandau",
  },
  {
    text: "Call Rabbi Stein back about the Landau family",
    type: "Call",
    dueDaysOffset: -1,
    targetType: "reference",
    targetKey: "R1",
  },
  {
    text: "Follow up with Mrs. Rosenberg re: Leah Steinberg",
    type: "Follow up",
    dueDaysOffset: 2,
    targetType: "shidduch",
    targetKey: "LeahSteinberg",
  },
  {
    text: "Confirm the date for Sara Weinberg",
    type: "Follow up",
    dueDaysOffset: 4,
    targetType: "shidduch",
    targetKey: "SaraWeinberg",
  },
];

// Extra realism: a second shadchan also redt the "yes" suggestion.
export const EXTRA_REDTS: Array<{
  suggestionKey: string;
  shadchanKey: string;
  redtDaysAgo: number;
}> = [{ suggestionKey: "ChaimLandau", shadchanKey: "S3", redtDaysAgo: 18 }];

type DemoAssetProfile = {
  suggestionKey?: string;
  singleKey?: "Rivky" | "Yaakov";
  slug: string;
  resumeAsset: AssetKey;
  previousResumeAssets?: readonly AssetKey[];
  photoAsset: AssetKey;
  visibility: "shared" | "private_parent";
};

export const PROFILE_ASSETS: readonly DemoAssetProfile[] = [
  {
    singleKey: "Rivky",
    slug: "rivky-klein",
    resumeAsset: "resumes/rivky-klein.pdf",
    previousResumeAssets: ["resumes/rivky-klein-2025.pdf"],
    photoAsset: "portraits/rivky-klein.jpg",
    visibility: "shared",
  },
  {
    singleKey: "Yaakov",
    slug: "yaakov-klein",
    resumeAsset: "resumes/yaakov-klein.pdf",
    previousResumeAssets: ["resumes/yaakov-klein-2025.pdf"],
    photoAsset: "portraits/yaakov-klein.jpg",
    visibility: "shared",
  },
  ...[
    ["AriRosenberg", "ari-rosenberg", "shared"],
    ["MenachemStern", "menachem-stern", "shared"],
    ["BoruchSofer", "boruch-sofer", "shared"],
    ["DovidBerkowitz", "dovid-berkowitz", "shared"],
    ["ShmuliKatz", "shmuli-katz", "shared"],
    ["YisroelFried", "yisroel-fried", "private_parent"],
    ["YehudaKlein", "yehuda-klein", "shared"],
    ["MosheDiamond", "moshe-diamond", "shared"],
    ["EliTraube", "eli-traube", "shared"],
    ["ChaimLandau", "chaim-landau", "shared"],
    ["YosefGross", "yosef-gross", "shared"],
    ["TzviAdler", "tzvi-adler", "shared"],
    ["NaftaliBerger", "naftali-berger", "shared"],
    ["LeahSteinberg", "leah-steinberg", "shared"],
    ["MiriamRoth", "miriam-roth", "shared"],
    ["SaraWeinberg", "sara-weinberg", "shared"],
    ["TamarWeiss", "tamar-weiss", "shared"],
    ["AriellaCohen", "ariella-cohen", "private_parent"],
    ["ChaniLevine", "chani-levine", "shared"],
    ["MiriamKaplan", "miriam-kaplan", "shared"],
  ].map(([suggestionKey, slug, visibility]) => ({
    suggestionKey,
    slug,
    resumeAsset: `resumes/${slug}.pdf` as AssetKey,
    previousResumeAssets:
      slug === "menachem-stern"
        ? (["resumes/menachem-stern-2025.pdf"] as readonly AssetKey[])
        : undefined,
    photoAsset: `portraits/${slug}.jpg` as AssetKey,
    visibility: visibility as "shared" | "private_parent",
  })),
];

export const RESUME_FILES: Array<{
  suggestionKey?: string;
  singleKey?: string;
  filename: string;
  assetKey: AssetKey;
  mimeType: "application/pdf";
}> = PROFILE_ASSETS.flatMap((profile) =>
  [...(profile.previousResumeAssets ?? []), profile.resumeAsset].map(
    (assetKey) => ({
      suggestionKey: profile.suggestionKey,
      singleKey: profile.singleKey,
      filename: assetKey.split("/").at(-1) ?? `${profile.slug}.pdf`,
      assetKey,
      mimeType: "application/pdf" as const,
    }),
  ),
);

export const RESUME_PHOTOS: Array<{
  suggestionKey?: string;
  singleKey?: string;
  filename: string;
  assetKey: AssetKey;
  visibility: "shared" | "private_parent";
}> = PROFILE_ASSETS.map((profile) => ({
  suggestionKey: profile.suggestionKey,
  singleKey: profile.singleKey,
  filename: profile.photoAsset.split("/").at(-1) ?? `${profile.slug}.jpg`,
  assetKey: profile.photoAsset,
  visibility: profile.visibility,
}));

export const ENTITY_FILES: Array<{
  targetType: "shidduch" | "reference";
  targetKey: string;
  filename: string;
  assetKey: AssetKey;
  mimeType: string;
  visibility: "shared" | "private_parent";
}> = [
  {
    targetType: "shidduch",
    targetKey: "AriRosenberg",
    filename: "family-notes.pdf",
    assetKey: "misc/family-notes.pdf",
    mimeType: "application/pdf",
    visibility: "shared",
  },
  {
    targetType: "shidduch",
    targetKey: "ChaimLandau",
    filename: "reference-summary.pdf",
    assetKey: "misc/reference-summary.pdf",
    mimeType: "application/pdf",
    visibility: "shared",
  },
  {
    targetType: "reference",
    targetKey: "R1",
    filename: "stein-notes.pdf",
    assetKey: "misc/stein-notes.pdf",
    mimeType: "application/pdf",
    visibility: "shared",
  },
];

/**
 * Server-owned graph for the official onboarding bundle. The row content is
 * intentionally small and key-based: seed_demo resolves these keys to real
 * database IDs and records every resolved resource in demo_run_* manifest
 * tables. Actor addresses are documentation-only `.invalid` identities; the
 * seed function generates undisclosed high-entropy credentials for them.
 */
export type DemoBundleManifest = {
  version: string;
  contexts: readonly {
    key: string;
    kind: "household" | "shadchanus";
    name: string;
    root?: boolean;
  }[];
  actors: readonly {
    key: string;
    contextKey: string;
    role: "parent_admin" | "helper" | "shadchan";
    address: string;
    firstName: string;
    lastName: string;
  }[];
  scenarios: readonly {
    key: string;
    kind:
      | "invitation"
      | "connection"
      | "grant"
      | "discussion"
      | "listing"
      | "share"
      | "reminder"
      | "message"
      | "inbox";
    state: string;
    dependsOn?: readonly string[];
  }[];
};

/** The complete scenario contract is intentionally explicit: seed and UI
 * review code use these keys as a stable inventory, not as an open-ended bag
 * of illustrative rows.
 *
 * SINGLE TENANT. The demo is one family — the Klein household — and nothing
 * else. It used to seed two more contexts (a shadchanus office and a second
 * household) so the connection, cross-household child-grant and two-party
 * discussion scenarios had a real counterparty; that also put a context
 * switcher in the app bar, because ContextSwitcher renders for any login with
 * two or more contexts. A person trying the product is one family, so those
 * five scenarios (connection-accepted, connection-revoked, child-grant-accepted,
 * child-grant-revoked, two-party-discussion) and both companion contexts are
 * gone rather than hidden. `simulated-message-email` went with them: a
 * message delivery needs a correspondent, and there is nobody to message in a
 * one-family demo. The reminder and inbox deliveries stay, because those are
 * the product mailing THIS family. Those product features are unchanged and
 * still tested by the RLS suites — they simply are not part of the demo. */
export const OFFICIAL_DEMO_SCENARIO_INVENTORY = [
  {
    key: "membership-invite-accepted",
    kind: "invitation",
    state: "accepted",
  },
  { key: "membership-invite-pending", kind: "invitation", state: "pending" },
  { key: "shadchan-listing-preview", kind: "listing", state: "published" },
  { key: "single-listing-withdrawn", kind: "listing", state: "withdrawn" },
  { key: "synthetic-share-active", kind: "share", state: "active" },
  { key: "synthetic-share-accessed", kind: "share", state: "accessed" },
  { key: "simulated-reminder-email", kind: "reminder", state: "sent" },
  { key: "inbox-captured-simulated", kind: "inbox", state: "resolved" },
] as const;

export const OFFICIAL_DEMO_BUNDLE: DemoBundleManifest = {
  version: "official-onboarding-v1",
  contexts: [
    {
      key: "primary-household",
      kind: "household",
      name: "The Klein Family",
      root: true,
    },
  ],
  actors: [
    {
      key: "dovid-klein",
      contextKey: "primary-household",
      role: "parent_admin",
      address: "dovid.klein@demo.invalid",
      firstName: "Dovid",
      lastName: "Klein",
    },
    {
      // The second parent. A household is one or two parents (the product's
      // own model), so the accepted membership invitation has a real, local
      // invitee — it used to be sent to the second household's parent, which
      // is exactly the cross-account dependency this demo no longer has.
      key: "sarah-klein",
      contextKey: "primary-household",
      role: "parent_admin",
      address: "sarah.klein@demo.invalid",
      firstName: "Sarah",
      lastName: "Klein",
    },
  ],
  scenarios: OFFICIAL_DEMO_SCENARIO_INVENTORY,
};

export function validateOfficialDemoBundle(): void {
  const contextKeys = new Set(
    OFFICIAL_DEMO_BUNDLE.contexts.map((row) => row.key),
  );
  if (OFFICIAL_DEMO_BUNDLE.contexts.filter((row) => row.root).length !== 1) {
    throw new Error("official demo bundle requires exactly one root context");
  }
  if (
    OFFICIAL_DEMO_BUNDLE.actors.some(
      (actor) =>
        !contextKeys.has(actor.contextKey) ||
        !actor.address.endsWith("@demo.invalid") ||
        actor.firstName.trim().length === 0 ||
        actor.lastName.trim().length === 0,
    )
  ) {
    throw new Error(
      "official demo actors must have display names and fictional .invalid identities in a known context",
    );
  }
  const scenarioKeys = new Set(
    OFFICIAL_DEMO_BUNDLE.scenarios.map((row) => row.key),
  );
  if (
    OFFICIAL_DEMO_BUNDLE.scenarios.length !==
      OFFICIAL_DEMO_SCENARIO_INVENTORY.length ||
    OFFICIAL_DEMO_BUNDLE.scenarios.some((scenario, index) => {
      const expected:
        (typeof OFFICIAL_DEMO_SCENARIO_INVENTORY)[number] | undefined =
        OFFICIAL_DEMO_SCENARIO_INVENTORY[index];
      if (!expected) return true;
      return (
        scenario.key !== expected.key ||
        scenario.kind !== expected.kind ||
        scenario.state !== expected.state ||
        JSON.stringify(scenario.dependsOn ?? []) !==
          JSON.stringify(
            ("dependsOn" in expected ? expected.dependsOn : undefined) ?? [],
          )
      );
    }) ||
    scenarioKeys.size !== OFFICIAL_DEMO_SCENARIO_INVENTORY.length
  ) {
    throw new Error(
      "official demo scenario inventory does not match its contract",
    );
  }
  for (const scenario of OFFICIAL_DEMO_BUNDLE.scenarios) {
    if (
      scenario.dependsOn?.some((dependency) => !scenarioKeys.has(dependency))
    ) {
      throw new Error(
        `official demo scenario ${scenario.key} has an unknown dependency`,
      );
    }
  }
}

export const MEDICAL_NOTES: Array<{ suggestionKey: string; body: string }> = [
  {
    suggestionKey: "ChaimLandau",
    body: "No concerns noted. Routine check with family doctor completed.",
  },
  {
    suggestionKey: "SaraWeinberg",
    body: "Allergy to penicillin disclosed; not a concern for shidduch.",
  },
];

export const EXTERNAL_LINKS: Array<{
  suggestionKey: string;
  url: string;
  label: string;
}> = [
  {
    suggestionKey: "ChaimLandau",
    url: "https://example-shidduch-site.com/profile/chaim-landau",
    label: "Shidduch profile",
  },
  {
    suggestionKey: "MiriamRoth",
    url: "https://example-shidduch-site.com/profile/miriam-roth",
    label: "Shidduch profile",
  },
];

export const DATE_RECORDS: Array<{
  singleKey: "Rivky" | "Yaakov";
  personName: string;
  personLocation: string;
  daysAgo: number;
  outcome: string;
  notes: string;
}> = [
  {
    singleKey: "Yaakov",
    personName: "Miriam Kaplan",
    personLocation: "Monsey, NY",
    daysAgo: 30,
    outcome: "no",
    notes: "Timing and location were not aligned.",
  },
  {
    singleKey: "Rivky",
    personName: "Naftali Berger",
    personLocation: "Lakewood, NJ",
    daysAgo: 35,
    outcome: "no",
    notes: "Different hashkafos.",
  },
];

export const STATUS_CHANGES: Array<{
  suggestionKey: string;
  from: PipelineState;
  to: PipelineState;
  body?: string;
  atDaysAgo: number;
}> = [
  {
    suggestionKey: "ChaimLandau",
    from: "look_into",
    to: "yes",
    body: "Both sides very interested; moving forward.",
    atDaysAgo: 25,
  },
  {
    suggestionKey: "TzviAdler",
    from: "look_into",
    to: "unsure",
    body: "Still checking references; undecided.",
    atDaysAgo: 20,
  },
  {
    suggestionKey: "NaftaliBerger",
    from: "look_into",
    to: "no",
    body: "Different hashkafa — not the right fit.",
    atDaysAgo: 35,
  },
  {
    suggestionKey: "SaraWeinberg",
    from: "look_into",
    to: "yes",
    body: "Great phone call with the mother; very promising.",
    atDaysAgo: 22,
  },
  {
    suggestionKey: "MiriamKaplan",
    from: "look_into",
    to: "no",
    body: "Timing and location were not aligned.",
    atDaysAgo: 30,
  },
];

/** Fail closed if the hand-authored seed ever drifts out of its demo contract. */
export function validateDemoDataset(): void {
  const allSuggestions = [...RIVKY_SUGGESTIONS, ...YAAKOV_SUGGESTIONS];
  const suggestionKeys = new Set(allSuggestions.map((row) => row.key));
  const referenceKeys = new Set(REFERENCES.map((row) => row.key));
  const shadchanKeys = new Set(SHADCHANIM.map((row) => row.key));
  const stages: PipelineState[] = [
    "new",
    "look_into",
    "not_sure",
    "for_sure_not",
    "yes",
    "unsure",
    "no",
  ];

  if (
    SINGLES.length !== 2 ||
    SINGLES.filter((row) => row.gender === "female").length !== 1 ||
    SINGLES.filter((row) => row.gender === "male").length !== 1
  ) {
    throw new Error("demo requires exactly one adult woman and one adult man");
  }
  if (
    SINGLE_PREFERENCES.length !== SINGLES.length ||
    SINGLE_NOTES.length !== SINGLES.length ||
    new Set(SINGLE_PREFERENCES.map((row) => row.singleKey)).size !==
      SINGLES.length ||
    new Set(SINGLE_NOTES.map((row) => row.singleKey)).size !== SINGLES.length ||
    SINGLE_PREFERENCES.some(
      (row) =>
        !SINGLES.some((single) => single.first_name_en === row.singleKey),
    ) ||
    SINGLE_NOTES.some(
      (row) =>
        !SINGLES.some((single) => single.first_name_en === row.singleKey),
    ) ||
    SINGLE_PREFERENCES.some((row) => row.body.trim().length === 0) ||
    SINGLE_NOTES.some((row) => row.body.trim().length === 0)
  ) {
    throw new Error(
      "demo private single content must cover each seeded single exactly once",
    );
  }
  const adultCutoff = new Date();
  adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
  if (
    SINGLES.some((row) => {
      const dob = new Date(`${row.dob}T00:00:00.000Z`);
      return Number.isNaN(dob.getTime()) || dob > adultCutoff;
    }) ||
    allSuggestions.some(
      (row) => !Number.isInteger(row.age) || row.age < 18 || row.age > 100,
    )
  ) {
    throw new Error("every demo single and suggestion must be an adult");
  }
  if (
    RIVKY_SUGGESTIONS.length !== 13 ||
    YAAKOV_SUGGESTIONS.length !== 7 ||
    suggestionKeys.size !== 20
  ) {
    throw new Error("demo requires 13 Rivky and 7 Yaakov suggestions");
  }
  if (RIVKY_SUGGESTIONS.some((row) => row.sex !== "male")) {
    throw new Error("Rivky's demo suggestions must all be men");
  }
  if (YAAKOV_SUGGESTIONS.some((row) => row.sex !== "female")) {
    throw new Error("Yaakov's demo suggestions must all be women");
  }
  for (const [label, suggestions] of [
    ["Rivky", RIVKY_SUGGESTIONS],
    ["Yaakov", YAAKOV_SUGGESTIONS],
  ] as const) {
    for (const stage of stages) {
      if (!suggestions.some((row) => row.targetState === stage)) {
        throw new Error(`${label}'s demo pipeline is missing ${stage}`);
      }
    }
  }
  if (allSuggestions.some((row) => !shadchanKeys.has(row.shadchanKey))) {
    throw new Error("demo suggestion points to an unknown shadchan");
  }
  if (EXTRA_REDTS.some((row) => !shadchanKeys.has(row.shadchanKey))) {
    throw new Error("demo extra redt points to an unknown shadchan");
  }
  if (
    DATE_RECORDS.some(
      (row) =>
        !["Rivky", "Yaakov"].includes(row.singleKey) ||
        !Number.isInteger(row.daysAgo) ||
        row.daysAgo < 0,
    )
  ) {
    throw new Error("demo date record points to an invalid single or date");
  }

  const dependentSuggestionKeys = [
    ...REFERENCE_LINKS.map((row) => row.suggestionKey),
    ...TIMELINE_NOTES.map((row) => row.suggestionKey),
    ...STATUS_CHANGES.map((row) => row.suggestionKey),
    ...TASKS.filter((row) => row.targetType === "shidduch").map(
      (row) => row.targetKey,
    ),
    ...EXTRA_REDTS.map((row) => row.suggestionKey),
    ...PROFILE_ASSETS.flatMap((row) =>
      row.suggestionKey ? [row.suggestionKey] : [],
    ),
    ...ENTITY_FILES.filter((row) => row.targetType === "shidduch").map(
      (row) => row.targetKey,
    ),
    ...MEDICAL_NOTES.map((row) => row.suggestionKey),
    ...EXTERNAL_LINKS.map((row) => row.suggestionKey),
  ];
  const unknownSuggestion = dependentSuggestionKeys.find(
    (key) => !suggestionKeys.has(key),
  );
  if (unknownSuggestion) {
    throw new Error(
      `demo dependency points to unknown suggestion ${unknownSuggestion}`,
    );
  }

  const dependentReferenceKeys = [
    ...REFERENCE_LINKS.map((row) => row.referenceKey),
    ...TASKS.filter((row) => row.targetType === "reference").map(
      (row) => row.targetKey,
    ),
    ...ENTITY_FILES.filter((row) => row.targetType === "reference").map(
      (row) => row.targetKey,
    ),
  ];
  const unknownReference = dependentReferenceKeys.find(
    (key) => !referenceKeys.has(key),
  );
  if (unknownReference) {
    throw new Error(
      `demo dependency points to unknown reference ${unknownReference}`,
    );
  }

  if (
    PROFILE_ASSETS.length !== 22 ||
    RESUME_FILES.length !== 25 ||
    RESUME_PHOTOS.length !== 22
  ) {
    throw new Error("demo requires 22 profiles, 25 resumes, and 22 photos");
  }
  const expectedProfileSlugs = new Map<string, string>([
    ...SINGLES.map(
      (row) =>
        [
          `single:${row.first_name_en}`,
          `${row.first_name_en}-${row.last_name_en}`.toLowerCase(),
        ] as const,
    ),
    ...allSuggestions.map(
      (row) =>
        [
          `suggestion:${row.key}`,
          row.name_en
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
        ] as const,
    ),
  ]);
  const actualProfileSubjects = PROFILE_ASSETS.map((profile) =>
    profile.singleKey
      ? `single:${profile.singleKey}`
      : `suggestion:${profile.suggestionKey}`,
  );
  if (
    new Set(actualProfileSubjects).size !== expectedProfileSlugs.size ||
    actualProfileSubjects.some(
      (subject) => !expectedProfileSlugs.has(subject),
    ) ||
    PROFILE_ASSETS.some((profile, index) => {
      const expectedSlug = expectedProfileSlugs.get(
        actualProfileSubjects[index],
      );
      return (
        profile.slug !== expectedSlug ||
        profile.resumeAsset !== `resumes/${profile.slug}.pdf` ||
        profile.photoAsset !== `portraits/${profile.slug}.jpg` ||
        profile.previousResumeAssets?.some(
          (asset) =>
            !asset.startsWith(`resumes/${profile.slug}-`) ||
            !asset.endsWith(".pdf"),
        ) === true
      );
    })
  ) {
    throw new Error("demo profile identity and asset mappings are incomplete");
  }
  if (
    new Set(RESUME_FILES.map((file) => file.assetKey)).size !==
      RESUME_FILES.length ||
    new Set(RESUME_PHOTOS.map((photo) => photo.assetKey)).size !==
      RESUME_PHOTOS.length
  ) {
    throw new Error("demo profile assets must be unique per identity/version");
  }
  if (
    RESUME_FILES.some(
      (file) =>
        !file.assetKey.startsWith("resumes/") ||
        !file.filename.endsWith(".pdf"),
    ) ||
    RESUME_PHOTOS.some(
      (photo) =>
        !photo.assetKey.startsWith("portraits/") ||
        !photo.filename.endsWith(".jpg"),
    )
  ) {
    throw new Error("demo profile asset media types do not match their paths");
  }
}

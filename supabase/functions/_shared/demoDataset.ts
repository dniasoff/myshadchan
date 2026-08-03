// The curated realistic demo dataset (Stage A of onboarding). English-only,
// frum/yeshivish Lakewood family — the Sterns. See
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

export const SINGLES: DemoSingle[] = [
  {
    first_name_en: "Rivky",
    last_name_en: "Stern",
    gender: "female",
    dob: "2006-04-18",
    community: "Lakewood",
    status: "active",
  },
  {
    first_name_en: "Yaakov",
    last_name_en: "Stern",
    gender: "male",
    dob: "2003-09-02",
    community: "Lakewood",
    status: "active",
  },
];

export type DemoShadchan = {
  key: string;
  name: string;
  location: string;
  responsiveness: "high" | "medium" | "low";
};

export const SHADCHANIM: DemoShadchan[] = [
  {
    key: "S1",
    name: "Mrs. Leah Feldman",
    location: "Lakewood, NJ",
    responsiveness: "high",
  },
  {
    key: "S2",
    name: "Rabbi Shmuel Weiss",
    location: "Lakewood, NJ",
    responsiveness: "medium",
  },
  {
    key: "S3",
    name: "Mrs. Chaya Rosenberg",
    location: "Monsey, NY",
    responsiveness: "high",
  },
  {
    key: "S4",
    name: "Mrs. Sarah Greenberg",
    location: "Brooklyn, NY",
    responsiveness: "low",
  },
  {
    key: "S5",
    name: "Rabbi Yosef Kanarek",
    location: "Passaic, NJ",
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
  shadchanKey: string;
  redtDaysAgo: number;
  targetState: PipelineState;
  closeReason?: string;
};

// Rivky's pipeline (single = girl) — 7 boys, one per pipeline state.
export const RIVKY_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "AhronKlein",
    name_en: "Ahron Klein",
    father_en: "R' Moshe Klein",
    mother_en: "Esther Klein",
    seminary_en: "Beth Medrash Govoha (BMG)",
    location_en: "Lakewood, NJ",
    age: 23,
    height: "5'11\"",
    shadchanKey: "S1",
    redtDaysAgo: 4,
    targetState: "new",
  },
  {
    key: "YisroelMeirFriedman",
    name_en: "Yisroel Meir Friedman",
    father_en: "R' Dovid Friedman",
    mother_en: "Rochel Friedman",
    seminary_en: "Mir (Yerushalayim)",
    location_en: "Yerushalayim",
    age: 24,
    height: "5'10\"",
    shadchanKey: "S2",
    redtDaysAgo: 12,
    targetState: "look_into",
  },
  {
    key: "ShmuelBrog",
    name_en: "Shmuel Brog",
    father_en: "R' Aryeh Brog",
    mother_en: "Devora Brog",
    seminary_en: "Ner Yisroel (Baltimore)",
    location_en: "Baltimore, MD",
    age: 22,
    height: "5'9\"",
    shadchanKey: "S3",
    redtDaysAgo: 9,
    targetState: "not_sure",
  },
  {
    key: "NaftaliSchwartz",
    name_en: "Naftali Schwartz",
    father_en: "R' Yaakov Schwartz",
    mother_en: "Bracha Schwartz",
    seminary_en: "Yeshiva Chaim Berlin",
    location_en: "Brooklyn, NY",
    age: 25,
    height: "6'0\"",
    shadchanKey: "S4",
    redtDaysAgo: 20,
    targetState: "for_sure_not",
  },
  {
    key: "EliezerKatz",
    name_en: "Eliezer Katz",
    father_en: "R' Chaim Katz",
    mother_en: "Miriam Katz",
    seminary_en: "Yeshiva Gedolah of Philadelphia",
    location_en: "Philadelphia, PA",
    age: 23,
    height: "5'10\"",
    shadchanKey: "S1",
    redtDaysAgo: 30,
    targetState: "yes",
  },
  {
    key: "YosefMandel",
    name_en: "Yosef Mandel",
    father_en: "R' Shloime Mandel",
    mother_en: "Faigy Mandel",
    seminary_en: "Yeshiva Torah Vodaas",
    location_en: "Brooklyn, NY",
    age: 24,
    height: "5'8\"",
    shadchanKey: "S5",
    redtDaysAgo: 25,
    targetState: "unsure",
  },
  {
    key: "BinyominReiss",
    name_en: "Binyomin Reiss",
    father_en: "R' Zev Reiss",
    mother_en: "Leah Reiss",
    seminary_en: "Beth Medrash Govoha (BMG)",
    location_en: "Lakewood, NJ",
    age: 22,
    height: "5'11\"",
    shadchanKey: "S2",
    redtDaysAgo: 40,
    targetState: "no",
    closeReason: "Different hashkafa — not the right fit.",
  },
];

// Yaakov's pipeline (single = boy) — 5 girls across several states.
export const YAAKOV_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "EstherMalkaWeiss",
    name_en: "Esther Malka Weiss",
    father_en: "R' Shmuel Weiss",
    mother_en: "Rivka Weiss",
    seminary_en: "Bais Yaakov of Lakewood",
    location_en: "Lakewood, NJ",
    age: 19,
    height: "5'4\"",
    shadchanKey: "S3",
    redtDaysAgo: 3,
    targetState: "new",
  },
  {
    key: "DevoraLeahGross",
    name_en: "Devora Leah Gross",
    father_en: "R' Aryeh Gross",
    mother_en: "Sarah Gross",
    seminary_en: "Bais Yaakov of Yerushalayim (BJJ)",
    location_en: "Monsey, NY",
    age: 20,
    height: "5'6\"",
    shadchanKey: "S1",
    redtDaysAgo: 10,
    targetState: "look_into",
  },
  {
    key: "ChanaRosen",
    name_en: "Chana Rosen",
    father_en: "R' Dovid Rosen",
    mother_en: "Miriam Rosen",
    seminary_en: "Bais Yaakov of Baltimore",
    location_en: "Baltimore, MD",
    age: 18,
    height: "5'2\"",
    shadchanKey: "S4",
    redtDaysAgo: 15,
    targetState: "for_sure_not",
  },
  {
    key: "ShiraFeldman",
    name_en: "Shira Feldman",
    father_en: "R' Yosef Feldman",
    mother_en: "Chava Feldman",
    seminary_en: "Michlalah (Yerushalayim)",
    location_en: "Passaic, NJ",
    age: 19,
    height: "5'5\"",
    shadchanKey: "S5",
    redtDaysAgo: 28,
    targetState: "yes",
  },
  {
    key: "BrachaGold",
    name_en: "Bracha Gold",
    father_en: "R' Menachem Gold",
    mother_en: "Rochel Gold",
    seminary_en: "Bais Yaakov of Lakewood",
    location_en: "Lakewood, NJ",
    age: 20,
    height: "5'7\"",
    shadchanKey: "S2",
    redtDaysAgo: 35,
    targetState: "no",
    closeReason: "Ages didn't work out.",
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
    suggestionKey: "EliezerKatz",
    whatTheySaid:
      "Top bochur in his shiur — serious about learning, excellent middos. Well-respected family. Gave a very strong recommendation.",
  },
  {
    referenceKey: "R2",
    suggestionKey: "DevoraLeahGross",
    whatTheySaid:
      "Knew her well in seminary — mature, responsible, wonderful family. Would be a great fit for a learning boy.",
  },
  {
    referenceKey: "R1",
    suggestionKey: "AhronKlein",
    whatTheySaid:
      "Knew him from a previous shidduch inquiry. Very solid boy with a warm family. Would be a good match for a Lakewood girl.",
  },
  {
    referenceKey: "R3",
    suggestionKey: "ShiraFeldman",
    whatTheySaid:
      "Neighbor for several years. The family is quiet, ehrliche, and very close. Shira is helpful and mature.",
  },
  {
    referenceKey: "R4",
    suggestionKey: "YosefMandel",
    whatTheySaid:
      "Chavrusa for a full zeman. Yosef is consistent, has good derech eretz, and takes learning seriously. Recommended warmly.",
  },
  {
    referenceKey: "R2",
    suggestionKey: "EstherMalkaWeiss",
    whatTheySaid:
      "Former teacher. Esther Malka is a poised, responsible girl with a strong sense of family. Very positive impression.",
  },
];

// Plain timeline notes on suggestions.
export const TIMELINE_NOTES: Array<{ suggestionKey: string; body: string }> = [
  {
    suggestionKey: "EliezerKatz",
    body: "Parents sound very interested. Waiting to hear back after they check into our side. References so far are excellent.",
  },
  {
    suggestionKey: "YisroelMeirFriedman",
    body: "Redt by Rabbi Weiss — learning in Mir, supposed to be an outstanding bochur. Need to call references this week.",
  },
  {
    suggestionKey: "DevoraLeahGross",
    body: "Seminary teacher gave a glowing report. Planning to set up a call between the parents.",
  },
  {
    suggestionKey: "ShiraFeldman",
    body: "Parents spoke last night. Both sides are warm and practical; scheduling a second call.",
  },
  {
    suggestionKey: "AhronKlein",
    body: "Resume looks strong. Shadchan says he is a masmid with excellent middos; checking references.",
  },
  {
    suggestionKey: "YosefMandel",
    body: "Mixed reports from references. Holding off until we can speak directly to the rebbe.",
  },
  {
    suggestionKey: "EstherMalkaWeiss",
    body: "Just redt by Mrs. Rosenberg. Need to review resume and set up parent call.",
  },
  {
    suggestionKey: "BinyominReiss",
    body: "Closed after one date — different hashkafos. Spoke to shadchan respectfully.",
  },
  {
    suggestionKey: "NaftaliSchwartz",
    body: "Spoke to references; not the right fit. Will move to for-sure-not.",
  },
  {
    suggestionKey: "BrachaGold",
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
    text: "Call Mrs. Feldman to follow up on Eliezer Katz",
    type: "Call",
    dueDaysOffset: -2,
    targetType: "shidduch",
    targetKey: "EliezerKatz",
  },
  {
    text: "Call Rabbi Stein back about the Katz family",
    type: "Call",
    dueDaysOffset: -1,
    targetType: "reference",
    targetKey: "R1",
  },
  {
    text: "Follow up with Mrs. Rosenberg re: Esther Malka Weiss",
    type: "Follow up",
    dueDaysOffset: 2,
    targetType: "shidduch",
    targetKey: "EstherMalkaWeiss",
  },
  {
    text: "Confirm the date for Shira Feldman",
    type: "Follow up",
    dueDaysOffset: 4,
    targetType: "shidduch",
    targetKey: "ShiraFeldman",
  },
];

// Extra realism: a second shadchan also redt the "yes" suggestion.
export const EXTRA_REDTS: Array<{
  suggestionKey: string;
  shadchanKey: string;
  redtDaysAgo: number;
}> = [{ suggestionKey: "EliezerKatz", shadchanKey: "S3", redtDaysAgo: 18 }];

export type AssetKey =
  | "rivky"
  | "yaakov"
  | "ahron"
  | "eliezer"
  | "yosef"
  | "estherMalka"
  | "devoraLeah"
  | "shira"
  | "familyNotes"
  | "referenceSummary"
  | "steinNotes";

export const RESUME_FILES: Array<{
  suggestionKey?: string;
  singleKey?: string;
  filename: string;
  assetKey: AssetKey;
  mimeType: "application/pdf";
}> = [
  {
    singleKey: "Rivky",
    filename: "rivky-stern.pdf",
    assetKey: "rivky",
    mimeType: "application/pdf",
  },
  {
    singleKey: "Yaakov",
    filename: "yaakov-stern.pdf",
    assetKey: "yaakov",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "AhronKlein",
    filename: "ahron-klein.pdf",
    assetKey: "ahron",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "EliezerKatz",
    filename: "eliezer-katz.pdf",
    assetKey: "eliezer",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "YosefMandel",
    filename: "yosef-mandel.pdf",
    assetKey: "yosef",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "EstherMalkaWeiss",
    filename: "esther-malka-weiss.pdf",
    assetKey: "estherMalka",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "DevoraLeahGross",
    filename: "devora-leah-gross.pdf",
    assetKey: "devoraLeah",
    mimeType: "application/pdf",
  },
  {
    suggestionKey: "ShiraFeldman",
    filename: "shira-feldman.pdf",
    assetKey: "shira",
    mimeType: "application/pdf",
  },
];

export const RESUME_PHOTOS: Array<{
  suggestionKey?: string;
  singleKey?: string;
  filename: string;
  assetKey: AssetKey;
  visibility: "shared" | "private_parent";
}> = [
  {
    singleKey: "Rivky",
    filename: "rivky-stern.jpg",
    assetKey: "rivky",
    visibility: "shared",
  },
  {
    singleKey: "Yaakov",
    filename: "yaakov-stern.jpg",
    assetKey: "yaakov",
    visibility: "shared",
  },
  {
    suggestionKey: "AhronKlein",
    filename: "ahron-klein.jpg",
    assetKey: "ahron",
    visibility: "shared",
  },
  {
    suggestionKey: "EliezerKatz",
    filename: "eliezer-katz.jpg",
    assetKey: "eliezer",
    visibility: "shared",
  },
  {
    suggestionKey: "ShiraFeldman",
    filename: "shira-feldman.jpg",
    assetKey: "shira",
    visibility: "private_parent",
  },
  {
    suggestionKey: "DevoraLeahGross",
    filename: "devora-leah-gross.jpg",
    assetKey: "devoraLeah",
    visibility: "shared",
  },
];

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
    targetKey: "AhronKlein",
    filename: "family-notes.pdf",
    assetKey: "familyNotes",
    mimeType: "application/pdf",
    visibility: "shared",
  },
  {
    targetType: "shidduch",
    targetKey: "EliezerKatz",
    filename: "reference-summary.pdf",
    assetKey: "referenceSummary",
    mimeType: "application/pdf",
    visibility: "shared",
  },
  {
    targetType: "reference",
    targetKey: "R1",
    filename: "stein-notes.pdf",
    assetKey: "steinNotes",
    mimeType: "application/pdf",
    visibility: "shared",
  },
];

export const MEDICAL_NOTES: Array<{ suggestionKey: string; body: string }> = [
  {
    suggestionKey: "EliezerKatz",
    body: "No concerns noted. Routine check with family doctor completed.",
  },
  {
    suggestionKey: "ShiraFeldman",
    body: "Allergy to penicillin disclosed; not a concern for shidduch.",
  },
];

export const EXTERNAL_LINKS: Array<{
  suggestionKey: string;
  url: string;
  label: string;
}> = [
  {
    suggestionKey: "EliezerKatz",
    url: "https://example-shidduch-site.com/profile/eliezer-katz",
    label: "Shidduch profile",
  },
  {
    suggestionKey: "DevoraLeahGross",
    url: "https://example-shidduch-site.com/profile/devora-leah-gross",
    label: "Shidduch profile",
  },
];

export const DATE_RECORDS: Array<{
  singleKey: string;
  personName: string;
  personLocation: string;
  dateOn: string;
  outcome: string;
  notes: string;
}> = [
  {
    singleKey: "Yaakov",
    personName: "Bracha Gold",
    personLocation: "Lakewood, NJ",
    dateOn: daysAgo(30),
    outcome: "no",
    notes: "Nice girl, ages didn't work out.",
  },
  {
    singleKey: "Rivky",
    personName: "Binyomin Reiss",
    personLocation: "Lakewood, NJ",
    dateOn: daysAgo(35),
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
    suggestionKey: "EliezerKatz",
    from: "look_into",
    to: "yes",
    body: "Both sides very interested; moving forward.",
    atDaysAgo: 25,
  },
  {
    suggestionKey: "YosefMandel",
    from: "look_into",
    to: "unsure",
    body: "Still checking references; undecided.",
    atDaysAgo: 20,
  },
  {
    suggestionKey: "BinyominReiss",
    from: "look_into",
    to: "no",
    body: "Different hashkafa — not the right fit.",
    atDaysAgo: 35,
  },
  {
    suggestionKey: "ShiraFeldman",
    from: "look_into",
    to: "yes",
    body: "Great phone call with the mother; very promising.",
    atDaysAgo: 22,
  },
  {
    suggestionKey: "BrachaGold",
    from: "look_into",
    to: "no",
    body: "Ages didn't work out.",
    atDaysAgo: 30,
  },
];

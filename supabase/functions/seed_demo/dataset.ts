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

export function daysFromNowIso(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

export type DemoChild = {
  first_name_en: string;
  last_name_en: string;
  gender: "male" | "female";
  dob: string;
  community: string;
  status: string;
};

export const CHILDREN: DemoChild[] = [
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
  { key: "S1", name: "Mrs. Leah Feldman", location: "Lakewood, NJ", responsiveness: "high" },
  { key: "S2", name: "Rabbi Shmuel Weiss", location: "Lakewood, NJ", responsiveness: "medium" },
  { key: "S3", name: "Mrs. Chaya Rosenberg", location: "Monsey, NY", responsiveness: "high" },
  { key: "S4", name: "Mrs. Sarah Greenberg", location: "Brooklyn, NY", responsiveness: "low" },
  { key: "S5", name: "Rabbi Yosef Kanarek", location: "Passaic, NJ", responsiveness: "medium" },
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
  | "new"
  | "look_into"
  | "not_sure"
  | "for_sure_not"
  | "yes"
  | "unsure"
  | "no";

export type DemoSuggestion = {
  key: string;
  name_en: string;
  parents_en: string;
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

// Rivky's pipeline (child = girl) — 7 boys, one per pipeline state.
export const RIVKY_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "AhronKlein",
    name_en: "Ahron Klein",
    parents_en: "R' Moshe & Esther Klein",
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
    parents_en: "R' Dovid & Rochel Friedman",
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
    parents_en: "R' Aryeh & Devora Brog",
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
    parents_en: "R' Yaakov & Bracha Schwartz",
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
    parents_en: "R' Chaim & Miriam Katz",
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
    parents_en: "R' Shloime & Faigy Mandel",
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
    parents_en: "R' Zev & Leah Reiss",
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

// Yaakov's pipeline (child = boy) — 5 girls across several states.
export const YAAKOV_SUGGESTIONS: DemoSuggestion[] = [
  {
    key: "EstherMalkaWeiss",
    name_en: "Esther Malka Weiss",
    parents_en: "R' Shmuel & Rivka Weiss",
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
    parents_en: "R' Aryeh & Sarah Gross",
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
    parents_en: "R' Dovid & Miriam Rosen",
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
    parents_en: "R' Yosef & Chava Feldman",
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
    parents_en: "R' Menachem & Rochel Gold",
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

import type {
  CallStatus,
  ConversationLogEntry,
  Interaction,
  Reference,
  ReferenceLink,
  Task,
} from "../../../types";
import type { Db } from "./types";

// References domain seed (AD-10 FakeRest mirror, references-entity-spec.md
// §2/§3). Runs AFTER generateShidduchimDomain() so reference_links can point
// at real shidduchim ids. Deliberately hand-authored (not faker-random) so
// the repeat-recognition panel and the near-duplicate merge flow are
// demoable out of the box, the same way shidduchim.ts hand-authors its board.

const ACCOUNT_ID = 1;

type ReferenceSeed = {
  name_en: string;
  name_he: string | null;
  relationship: string;
  phone: string;
  school: string | null;
  grad_year: number | null;
};

// Reference #2 ("Haim Feldman") is a DELIBERATE near-duplicate of #1 ("Chaim
// Feldman"): same phone number typed in a different format, slightly
// different English spelling. matchReferenceOnEntry() must surface this pair
// on a phone match alone, and mergeReferences() must be able to fold them.
const referenceSeeds: ReferenceSeed[] = [
  {
    name_en: "Chaim Feldman",
    name_he: "חיים פלדמן",
    relationship: "Rebbi",
    phone: "054-222-3344",
    school: "Ner Yisroel",
    grad_year: null,
  },
  {
    name_en: "Haim Feldman",
    name_he: null,
    relationship: "Family friend",
    phone: "+972-54-222-3344", // same number as #1, different formatting
    school: null,
    grad_year: null,
  },
  {
    name_en: "Devorah Klein",
    name_he: "דבורה קליין",
    relationship: "Rebbetzin",
    phone: "732-555-8890",
    school: "BMG",
    grad_year: null,
  },
  {
    name_en: "Moshe Adler",
    name_he: "משה אדלר",
    relationship: "Menahel",
    phone: "410-555-1120",
    school: "Ner Yisroel",
    grad_year: null,
  },
  {
    name_en: "Yitzchok Berkowitz",
    name_he: "יצחק ברקוביץ",
    relationship: "Chavrusa",
    phone: "201-555-4471",
    school: "Mir",
    grad_year: 2023,
  },
  {
    name_en: "Chaya Fried",
    name_he: "חיה פריד",
    relationship: "Seminary teacher",
    phone: "973-555-2298",
    school: "Bnos Chava",
    grad_year: null,
  },
  {
    name_en: "Basya Adler",
    name_he: "בשיה אדלר",
    relationship: "Seminary teacher",
    phone: "646-555-7734",
    school: "Bais Yaakov",
    grad_year: null,
  },
  {
    name_en: "Yankel Cohen",
    name_he: "יענקל כהן",
    relationship: "Neighbor",
    phone: "917-555-3321",
    school: null,
    grad_year: null,
  },
  {
    name_en: "Shaindy Gross",
    name_he: "שיינדי גרוס",
    relationship: "Camp counselor",
    phone: "845-555-6602",
    school: "Bnos Devorah",
    grad_year: 2021,
  },
];

type LinkSeed = {
  referenceIndex: number; // 0-based index into referenceSeeds
  shidduchimId: number;
  callStatus: CallStatus;
  whatTheySaid: string | null;
  calledOn: string | null; // null = never called (call_status stays not_started)
  relationshipOverride?: string;
};

// Reference #1 (Chaim Feldman, the Ner Yisroel rebbi) and #3 (Devorah Klein,
// a BMG rebbetzin) and #5 (Yitzchok Berkowitz, a Mir chavrusa) each link to
// THREE different shidduchim -- the repeat-recognition demo data ("You've
// spoken to X about N other singles").
const linkSeeds: LinkSeed[] = [
  {
    referenceIndex: 0,
    shidduchimId: 1, // Ari Rosenberg, Ner Yisroel
    callStatus: "answered",
    whatTheySaid: "Wonderful bochur, always available to learn with others.",
    calledOn: "2026-07-15T14:30:00.000Z",
  },
  {
    referenceIndex: 0,
    shidduchimId: 9, // Eli Traube, Ner Yisroel
    callStatus: "no_answer",
    whatTheySaid: null,
    calledOn: "2026-07-10T10:05:00.000Z",
  },
  {
    referenceIndex: 0,
    shidduchimId: 12, // Tzvi Adler, Ner Yisroel
    callStatus: "they_will_call_back",
    whatTheySaid: null,
    calledOn: "2026-07-18T16:45:00.000Z",
    // Same person, different hat: "the rebbi" for most, but a family friend
    // specifically where Tzvi Adler is concerned. Demonstrates
    // effective_relationship falling back per-link (AD-10 §1.2a).
    relationshipOverride: "Family friend",
  },
  {
    referenceIndex: 1,
    shidduchimId: 4, // Dovid Berkowitz
    callStatus: "not_started",
    whatTheySaid: null,
    calledOn: null,
  },
  {
    referenceIndex: 2,
    shidduchimId: 3, // Boruch Sofer, BMG
    callStatus: "answered",
    whatTheySaid: "Serious learner, top of his seder.",
    calledOn: "2026-07-12T09:15:00.000Z",
  },
  {
    referenceIndex: 2,
    shidduchimId: 7, // Yehuda Klein, BMG
    callStatus: "call_back",
    whatTheySaid: null,
    calledOn: "2026-07-16T11:00:00.000Z",
  },
  {
    referenceIndex: 2,
    shidduchimId: 11, // Yosef Gross, BMG
    callStatus: "answered",
    whatTheySaid: "Menahel of the shiur, very put together.",
    calledOn: "2026-07-08T13:20:00.000Z",
  },
  {
    referenceIndex: 3,
    shidduchimId: 1, // Ari Rosenberg -- a second reference for the same shidduch
    callStatus: "answered",
    whatTheySaid: "Excellent middos, natural leader.",
    calledOn: "2026-07-14T17:10:00.000Z",
  },
  {
    referenceIndex: 4,
    shidduchimId: 5, // Shmuli Katz, Mir
    callStatus: "answered",
    whatTheySaid: "Learns b'iyun, great chavrusa.",
    calledOn: "2026-07-11T08:40:00.000Z",
  },
  {
    referenceIndex: 4,
    shidduchimId: 8, // Moshe Diamond, Mir
    callStatus: "no_answer",
    whatTheySaid: null,
    calledOn: "2026-07-13T15:50:00.000Z",
  },
  {
    referenceIndex: 4,
    shidduchimId: 10, // Chaim Landau, Mir
    callStatus: "they_will_call_back",
    whatTheySaid: null,
    calledOn: "2026-07-17T12:25:00.000Z",
  },
  {
    referenceIndex: 5,
    shidduchimId: 14, // Leah Steinberg, Bnos Chava
    callStatus: "not_started",
    whatTheySaid: null,
    calledOn: null,
  },
  {
    referenceIndex: 6,
    shidduchimId: 15, // Miriam Roth, Bais Yaakov
    callStatus: "answered",
    whatTheySaid: "Warm, dependable, excellent with the younger girls.",
    calledOn: "2026-07-09T10:30:00.000Z",
  },
  {
    referenceIndex: 7,
    shidduchimId: 6, // Yisroel Fried
    callStatus: "call_back",
    whatTheySaid: null,
    calledOn: "2026-07-19T18:00:00.000Z",
  },
  {
    referenceIndex: 8,
    shidduchimId: 16, // Sara Weinberg, Bnos Devorah
    callStatus: "answered",
    whatTheySaid: "Responsible, great with the campers.",
    calledOn: "2026-07-07T09:00:00.000Z",
  },
];

// Open reminders targeting a reference (polymorphic tasks.target_type =
// "reference"), so open_task_count on references_summary has data to show.
type ReferenceTaskSeed = {
  referenceIndex: number;
  text: string;
  type: string;
  dueDate: string;
};

const referenceTaskSeeds: ReferenceTaskSeed[] = [
  {
    referenceIndex: 1, // Haim Feldman -- never called yet
    text: "Call Haim Feldman about Dovid Berkowitz",
    type: "call",
    dueDate: "2026-07-25T12:00:00.000Z",
  },
  {
    referenceIndex: 5, // Chaya Fried
    text: "Follow up with Chaya Fried about Leah Steinberg",
    type: "call",
    dueDate: "2026-07-24T12:00:00.000Z",
  },
  {
    referenceIndex: 0, // Chaim Feldman
    text: "Ask Chaim Feldman about Tzvi Adler's learning habits",
    type: "follow-up",
    dueDate: "2026-07-28T12:00:00.000Z",
  },
];

const REFERENCE_CREATED_AT = "2026-01-01T00:00:00.000Z";

export const generateReferencesDomain = (db: Db) => {
  const references: Reference[] = referenceSeeds.map((seed, i) => ({
    id: i + 1,
    account_id: ACCOUNT_ID,
    name_en: seed.name_en,
    name_he: seed.name_he,
    relationship: seed.relationship,
    phone: seed.phone,
    school: seed.school,
    grad_year: seed.grad_year,
    created_at: REFERENCE_CREATED_AT,
  }));

  const referenceLinks: ReferenceLink[] = [];
  const interactions: Interaction[] = [];
  let linkId = 1;
  let interactionId = 1;

  linkSeeds.forEach((seed) => {
    const reference = references[seed.referenceIndex];
    const conversationLog: ConversationLogEntry[] = [];
    if (seed.calledOn) {
      conversationLog.push({
        at: seed.calledOn,
        call_status: seed.callStatus,
        text: seed.whatTheySaid,
        source: "manual",
        member_id: null,
      });
    }

    const linkCreatedAt = seed.calledOn ?? REFERENCE_CREATED_AT;
    const link: ReferenceLink = {
      id: linkId++,
      account_id: ACCOUNT_ID,
      reference_id: reference.id,
      shidduchim_id: seed.shidduchimId,
      resume_id: null,
      call_status: seed.callStatus,
      what_they_said: seed.whatTheySaid,
      conversation_log: conversationLog,
      relationship_override: seed.relationshipOverride ?? null,
      created_at: linkCreatedAt,
    };
    referenceLinks.push(link);

    interactions.push({
      id: interactionId++,
      account_id: ACCOUNT_ID,
      target_type: "reference",
      target_id: reference.id,
      scope: "shidduch" as const,
      reference_link_id: link.id,
      actor_member_id: null,
      kind: "link_created",
      body: null,
      metadata: { shidduchim_id: seed.shidduchimId },
      created_at: REFERENCE_CREATED_AT,
    });

    if (seed.calledOn) {
      interactions.push({
        id: interactionId++,
        account_id: ACCOUNT_ID,
        target_type: "reference",
        target_id: reference.id,
        scope: "shidduch" as const,
        reference_link_id: link.id,
        actor_member_id: null,
        kind: "call_logged",
        body: seed.whatTheySaid,
        metadata: {
          call_status: seed.callStatus,
          shidduchim_id: seed.shidduchimId,
          source: "manual",
        },
        created_at: seed.calledOn,
      });
    }
  });

  const referenceTasks: Task[] = referenceTaskSeeds.map((seed, i) => ({
    id: db.tasks.length + i,
    account_id: ACCOUNT_ID,
    target_type: "reference",
    target_id: references[seed.referenceIndex].id,
    type: seed.type,
    text: seed.text,
    due_date: seed.dueDate,
    done_date: undefined,
    sales_id: 0,
  }));

  db.references = references;
  db.reference_links = referenceLinks;
  db.interactions = interactions;
  db.tasks = [...db.tasks, ...referenceTasks];
};

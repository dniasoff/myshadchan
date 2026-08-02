import { generateMembers } from "./members";
import { generateReferencesDomain } from "./references";
import { generateShidduchimDomain } from "./shidduchim";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.members = generateMembers(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  // Set before generateShidduchimDomain(db): references.ts reads db.tasks.length
  // and spreads db.tasks, so an undefined db.tasks would crash the demo provider.
  db.tasks = [];
  // Invites as the one membership mechanism (Story 2.8) — no invite is sent
  // by default; InvitesSection.tsx's createInvite()/revokeInvite() are the
  // only writers.
  db.invites = [];
  // Files tab (Story 3.7) — no file is uploaded by default; FilesTab's own
  // upload/delete calls are the only writers.
  db.entity_files = [];
  // Communication (Story 7.1) — no discussion exists by default; the
  // Discussions tab's own createThread()/message-composer calls are the
  // only writers. `connections` has no client write path at all (AC-6) —
  // Epic 8's consent workflow is the only future writer — so it stays
  // empty here and is overwritten by generateShidduchimDomain() below with
  // the one seeded row Story 7.4 (Task 6) needs to exercise the connection
  // axis in the demo build.
  db.connections = [];
  // Story 8.2 — no invite is outstanding by default; the Settings
  // "Connect with a shadchan"/"Connect with a family" actions' own
  // createConnectionInvite()/revokeConnectionInvite() are the only writers.
  db.connection_invites = [];
  db.threads = [];
  db.thread_participants = [];
  db.messages = [];
  // Story 9.1 — no shadchan listing is published by default (AC-1's
  // opt-in requirement applies here too); the "Publish my listing" settings
  // panel's own create/update/delete calls are the only writers. Overwritten
  // by generateShidduchimDomain() below with Story 9.2's own single seeded
  // single-branch listing, the same "empty here, real row from
  // generateShidduchimDomain()" shape `db.connections` uses just below.
  db.listings = [];
  // Shidduchim pipeline domain (accounts, singles, shadchanim, shidduchim, ...)
  generateShidduchimDomain(db);
  // References domain (references, reference_links, interactions, reference
  // tasks) -- runs after shidduchim so it can link against real shidduchim ids.
  generateReferencesDomain(db);
  // A couple of un-triaged captures so the demo shows the inbox "front door"
  // (Epic 2). Unresolved -> they await one confirm step before becoming redts.
  const demoAccountId = db.accounts?.[0]?.id ?? 1;
  db.inbox_items = [
    {
      id: 1,
      account_id: demoAccountId,
      created_at: "2026-07-20T10:12:00.000Z",
      source: "whatsapp",
      sender: "Mrs. Feldman",
      raw_text:
        "Hi! I have a wonderful boy for Rivky — Dovid Berkowitz, BMG, from Lakewood. 24, learning well. Should I send the resume?",
      subject: null,
      attachments: null,
      status: "unresolved",
      single_id: null,
      shadchan_id: null,
      resolved_shidduchim_id: null,
    },
    {
      id: 2,
      account_id: demoAccountId,
      created_at: "2026-07-21T16:40:00.000Z",
      source: "email",
      sender: "a.shadchan@example.com",
      subject: "A suggestion",
      raw_text:
        "Attached is a resume — Shmuli Katz, Passaic, learning in Beis Medrash. Please call to discuss.",
      attachments: null,
      status: "unresolved",
      single_id: null,
      shadchan_id: null,
      resolved_shidduchim_id: null,
    },
  ];

  return db;
};

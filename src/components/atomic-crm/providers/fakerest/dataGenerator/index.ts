import { generateCompanies } from "./companies";
import { generateContactNotes } from "./contactNotes";
import { generateContacts } from "./contacts";
import { generateDealNotes } from "./dealNotes";
import { generateDeals } from "./deals";
import { finalize } from "./finalize";
import { generateReferencesDomain } from "./references";
import { generateSales } from "./sales";
import { generateShidduchimDomain } from "./shidduchim";
import { generateTags } from "./tags";
import { generateTasks } from "./tasks";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.sales = generateSales(db);
  db.tags = generateTags(db);
  db.companies = generateCompanies(db);
  db.contacts = generateContacts(db);
  db.contact_notes = generateContactNotes(db);
  db.deals = generateDeals(db);
  db.deal_notes = generateDealNotes(db);
  db.tasks = generateTasks(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  // Shidduchim pipeline domain (accounts, children, shadchanim, shidduchim, ...)
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
      child_id: null,
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
      child_id: null,
      shadchan_id: null,
      resolved_shidduchim_id: null,
    },
  ];
  // Child portal tokens (E7) start empty; the demo mints them on demand via the
  // provider's mintChildPortalToken so the share panel works without a backend.
  db.child_portal_tokens = [];
  finalize(db);

  return db;
};

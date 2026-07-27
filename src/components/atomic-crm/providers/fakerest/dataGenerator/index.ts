import { generateReferencesDomain } from "./references";
import { generateSales } from "./sales";
import { generateShidduchimDomain } from "./shidduchim";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.sales = generateSales(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  // Set before generateShidduchimDomain(db): references.ts reads db.tasks.length
  // and spreads db.tasks, so an undefined db.tasks would crash the demo provider.
  db.tasks = [];
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

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { validateReadOnly, validateWrite } from "./validateSql";

/**
 * RULING 7 for the MCP tools: references are reachable only through a
 * shidduch (or by naming the reference itself), and can never be created
 * unattached. These assertions run through the real validators, so they pin
 * what the deployed `query` and `mutate` tools accept — not an internal
 * helper's shape.
 */
describe("reference scope — reads", () => {
  it.each([
    ["bare reference table", 'SELECT * FROM "references"'],
    ["the summary view", "SELECT * FROM references_summary"],
    [
      "a schema-qualified summary view",
      "SELECT * FROM public.references_summary",
    ],
    [
      "a free-text search",
      "SELECT name_en, phone FROM references_summary WHERE name_en ILIKE '%gold%'",
    ],
    [
      "a paged roster",
      "SELECT name_en FROM references_summary ORDER BY name_en LIMIT 20",
    ],
    [
      "an aggregate over the whole book",
      "SELECT COUNT(*) FROM references_summary",
    ],
    [
      "a name roll-up that smuggles rows out through an aggregate",
      "SELECT string_agg(name_en, ',') FROM references_summary",
    ],
    ["the link table", "SELECT * FROM reference_links"],
    ["the link summary view", "SELECT * FROM reference_links_summary"],
    [
      "a join that anchors on nothing but the join key",
      'SELECT r.* FROM "references" r JOIN reference_links l ON l.reference_id = r.id',
    ],
    [
      "every shidduch's references at once",
      "SELECT rl.* FROM shidduchim s JOIN reference_links_summary rl ON rl.shidduchim_id = s.id",
    ],
    [
      "an unanchored read hidden inside a CTE",
      "WITH book AS (SELECT * FROM references_summary) SELECT * FROM book",
    ],
  ])("rejects %s", (_label, sql) => {
    expect(validateReadOnly(sql)).toMatch(/scoped to a shidduch/);
  });

  it.each([
    [
      "the references serving one shidduch",
      "SELECT reference_name_en, call_status FROM reference_links_summary WHERE shidduchim_id = 42",
    ],
    [
      "the references serving one shidduch, via an explicit join",
      'SELECT r.name_en FROM "references" r JOIN reference_links l ON l.reference_id = r.id WHERE l.shidduchim_id = 42',
    ],
    [
      "the references of a named set of shidduchim",
      "SELECT * FROM reference_links_summary WHERE shidduchim_id IN (1, 2, 3)",
    ],
    [
      "a shidduch named on the shidduchim side of the join",
      "SELECT rl.* FROM shidduchim s JOIN reference_links_summary rl ON rl.shidduchim_id = s.id WHERE s.id = 42",
    ],
    ["one reference by id", "SELECT * FROM references_summary WHERE id = 7"],
    [
      "one reference by id, qualified",
      'SELECT r.* FROM "references" r WHERE r.id = 7',
    ],
  ])("allows %s", (_label, sql) => {
    expect(validateReadOnly(sql)).toBeNull();
  });

  // Clause 4 of the ruling: the owner explicitly wants to see that the same
  // reference serves several matches. Naming the reference is the anchor.
  it("allows the cross-shidduch view of one reference", () => {
    expect(
      validateReadOnly(
        "SELECT shidduch_name_en, call_status, what_they_said FROM reference_links_summary WHERE reference_id = 7",
      ),
    ).toBeNull();
    expect(
      validateReadOnly(
        "SELECT COUNT(DISTINCT shidduchim_id) FROM reference_links WHERE reference_id = 7",
      ),
    ).toBeNull();
  });

  // display_task_list hydrates the label of a reference-linked task. The
  // reference set is determined by tasks, not by a reference-side filter, so
  // it is reachability rather than browsing.
  it("allows hydrating a reference label from a polymorphic task target", () => {
    expect(
      validateReadOnly(
        `SELECT t.id, t.text, r.name_en AS target_label
         FROM tasks t
         JOIN "references" r ON r.id = t.target_id
         WHERE t.target_type = 'reference' AND t.done_date IS NULL`,
      ),
    ).toBeNull();
  });

  it("leaves queries that never touch references alone", () => {
    expect(validateReadOnly("SELECT * FROM shidduchim_summary")).toBeNull();
    expect(validateReadOnly("SELECT * FROM shadchanim")).toBeNull();
  });
});

describe("reference scope — writes", () => {
  // The MCP twin of the ReferenceCreate orphan defect fixed in cbc311a: a
  // bare INSERT leaves a reference with zero reference_links, invisible in
  // the shidduch it was gathered for and unrecoverable by match-on-entry.
  it("rejects creating an unattached reference", () => {
    const error = validateWrite(
      `INSERT INTO "references" (name_en, phone) VALUES ('Rabbi Cohen', '555-0100')`,
    );
    expect(error).toMatch(/cannot be created unattached/);
    expect(error).toContain("link_reference_to_shidduch");
  });

  it("rejects an unattached INSERT even with RETURNING", () => {
    expect(
      validateWrite(
        `INSERT INTO "references" (name_en) VALUES ('Rabbi Cohen') RETURNING id`,
      ),
    ).toMatch(/cannot be created unattached/);
  });

  it("allows creating a reference and linking it in one statement", () => {
    expect(
      validateWrite(
        `WITH new_ref AS (
           INSERT INTO "references" (name_en, relationship, phone)
           VALUES ('Rabbi Cohen', 'shul rabbi', '555-0100') RETURNING id
         )
         SELECT public.link_reference_to_shidduch(new_ref.id, 42) FROM new_ref`,
      ),
    ).toBeNull();
  });

  it("rejects a reference_links row with no shidduch", () => {
    expect(
      validateWrite(
        "INSERT INTO reference_links (account_id, reference_id) VALUES (1, 7)",
      ),
    ).toMatch(/must set shidduchim_id/);
  });

  it("allows a reference_links row that names its shidduch", () => {
    expect(
      validateWrite(
        "INSERT INTO reference_links (account_id, reference_id, shidduchim_id) VALUES (1, 7, 42)",
      ),
    ).toBeNull();
  });

  it("rejects an unanchored mass update or delete of references", () => {
    expect(validateWrite(`UPDATE "references" SET phone = NULL`)).toMatch(
      /scoped to a shidduch/,
    );
    expect(validateWrite('DELETE FROM "references"')).toMatch(
      /scoped to a shidduch/,
    );
  });

  it("allows updating one named reference", () => {
    expect(
      validateWrite(`UPDATE "references" SET phone = '555-0100' WHERE id = 7`),
    ).toBeNull();
  });

  it("rejects copying the whole reference book out through an INSERT ... SELECT", () => {
    expect(
      validateWrite(
        "INSERT INTO tasks (text, target_type, target_id) SELECT name_en, 'reference', id FROM references_summary",
      ),
    ).toMatch(/scoped to a shidduch/);
  });

  it("leaves mutations that never touch references alone", () => {
    expect(
      validateWrite(
        "INSERT INTO shadchanim (name, location) VALUES ('Mrs. Feldman', 'Lakewood')",
      ),
    ).toBeNull();
    expect(validateWrite("DELETE FROM tasks WHERE id = 456")).toBeNull();
  });
});

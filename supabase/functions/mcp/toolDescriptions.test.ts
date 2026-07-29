// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  GET_SCHEMA_DESCRIPTION,
  MUTATE_DESCRIPTION,
  MUTATE_EXAMPLES,
  QUERY_DESCRIPTION,
  QUERY_EXAMPLES,
  REFERENCE_SCOPE_RULE,
} from "./toolDescriptions";
import { validateReadOnly, validateWrite } from "./validateSql";

/**
 * The tool descriptions are the contract an AI client reads before it writes
 * any SQL, so they are asserted as a contract — not left to drift while the
 * validators quietly disagree with them.
 */
const ALL_DESCRIPTIONS: [string, string][] = [
  ["get_schema", GET_SCHEMA_DESCRIPTION],
  ["query", QUERY_DESCRIPTION],
  ["mutate", MUTATE_DESCRIPTION],
];

describe("tool descriptions — RULING 7", () => {
  it.each(ALL_DESCRIPTIONS)(
    "%s does not advertise references_summary as a view to search or list",
    (_tool, description) => {
      const advertised = description.match(
        /^Use the \*_summary views \(([^)]*)\)/m,
      );
      if (advertised) {
        expect(advertised[1]).not.toContain("references_summary");
      }
      expect(description).not.toMatch(/Views \(like[^)]*references_summary/);
    },
  );

  it("mutate does not offer creating a reference as a free-standing action", () => {
    const capabilities = MUTATE_DESCRIPTION.slice(
      MUTATE_DESCRIPTION.indexOf("Use this tool for data modifications"),
      MUTATE_DESCRIPTION.indexOf("Row Level Security"),
    );
    expect(capabilities).not.toMatch(/references/i);
    expect(capabilities).toMatch(/shadchanim/);
  });

  it("query does not offer references as a standalone thing to ask about", () => {
    const useCases = QUERY_DESCRIPTION.slice(
      QUERY_DESCRIPTION.indexOf("Use this tool when the user asks"),
      QUERY_DESCRIPTION.indexOf("Row Level Security"),
    );
    // References may only be mentioned in a shidduch-bound phrasing.
    for (const line of useCases.split("\n")) {
      if (/reference/i.test(line)) {
        expect(line).toMatch(/shidduch/i);
      }
    }
  });

  it.each([
    ["query", QUERY_DESCRIPTION],
    ["mutate", MUTATE_DESCRIPTION],
    ["get_schema", GET_SCHEMA_DESCRIPTION],
  ])("%s states the reference scope rule verbatim", (_tool, description) => {
    expect(description).toContain(REFERENCE_SCOPE_RULE);
  });

  it("the rule names both the shidduch anchor and the reference anchor", () => {
    expect(REFERENCE_SCOPE_RULE).toContain("WHERE shidduchim_id = <id>");
    expect(REFERENCE_SCOPE_RULE).toContain("WHERE reference_id = <id>");
  });

  it("the rule preserves the cross-shidduch view the owner asked for", () => {
    expect(REFERENCE_SCOPE_RULE).toMatch(
      /which other matches have I spoken to this person about/i,
    );
  });

  it("the rule tells the client how to create a reference, not just that it cannot", () => {
    expect(REFERENCE_SCOPE_RULE).toContain("link_reference_to_shidduch");
    expect(MUTATE_DESCRIPTION).toMatch(
      /bare INSERT INTO "references" is rejected/,
    );
  });
});

describe("tool descriptions — examples are executable", () => {
  // The examples are what the client copies. If one of them would be
  // refused by the validator, the description is lying.
  it.each(QUERY_EXAMPLES.map((sql) => [sql] as const))(
    "query example passes validateReadOnly: %s",
    (sql) => {
      expect(validateReadOnly(sql)).toBeNull();
    },
  );

  it.each(MUTATE_EXAMPLES.map((sql) => [sql] as const))(
    "mutate example passes validateWrite: %s",
    (sql) => {
      expect(validateWrite(sql)).toBeNull();
    },
  );

  it("every example is actually embedded in its description", () => {
    for (const sql of QUERY_EXAMPLES) {
      expect(QUERY_DESCRIPTION).toContain(sql);
    }
    for (const sql of MUTATE_EXAMPLES) {
      expect(MUTATE_DESCRIPTION).toContain(sql);
    }
  });

  it("ships a worked example for each supported reference shape", () => {
    expect(QUERY_EXAMPLES.some((sql) => /shidduchim_id = 42/.test(sql))).toBe(
      true,
    );
    expect(QUERY_EXAMPLES.some((sql) => /reference_id = 7/.test(sql))).toBe(
      true,
    );
    expect(
      MUTATE_EXAMPLES.some((sql) => /link_reference_to_shidduch/.test(sql)),
    ).toBe(true);
  });
});

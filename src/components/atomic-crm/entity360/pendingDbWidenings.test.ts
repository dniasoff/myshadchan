import { describe, expect, it } from "vitest";

import { ENTITY_TARGET_TYPES } from "../types";
import { PENDING_DB_WIDENINGS } from "./pendingDbWidenings";

/**
 * Contract §8 rule 2 / AC 6. Reads `supabase/schemas/01_tables.sql` as raw
 * source text — the only in-repo `?raw` precedent is
 * `references/entitlementGate.guard.test.ts:16-20`'s `import.meta.glob`,
 * retargeted here per the story's own instruction — and asserts that every
 * named target-type check constraint NOT listed in `PENDING_DB_WIDENINGS`
 * has already reached full parity with `ENTITY_TARGET_TYPES`.
 *
 * Deliberately scoped to the three constraints contract §8 rule 1 names
 * (`tasks_target_type_check`, `interactions_target_type_check`,
 * `entity_files_target_type_check`), not a blanket scan of every
 * `*_target_type_check` constraint in the schema:
 * `identity_signals_target_type_check` (AD-5's dedupe match store) also
 * matches that naming pattern but is a DIFFERENT vocabulary —
 * `('reference', 'shidduch', 'date_record')` — and `date_record` is not an
 * `EntityTargetType` at all. A name-pattern scan would misclassify it as a
 * violation; this guard is not about "every check with target_type in its
 * name", it is about the one AD-13 polymorphic vocabulary `ENTITY_TARGET_TYPES`
 * governs.
 *
 * "At parity" (not "is a subset of") is the assertion actually made: a
 * check constraint whose value set is a *strict* subset of
 * `ENTITY_TARGET_TYPES` (e.g. today's `tasks_target_type_check`, missing
 * `single`) is exactly the case `PENDING_DB_WIDENINGS` exists to track, so a
 * mere subset check can never fail and could not produce the red run this
 * file records below. Parity — every `ENTITY_TARGET_TYPES` value present in
 * the constraint — is what makes "remove an entry from
 * `PENDING_DB_WIDENINGS` before its migration lands" a real, catchable bug,
 * matching §8 rule 1's "three DB check constraints must end up with the
 * same four values."
 */

const sqlSources = import.meta.glob(
  "../../../../supabase/schemas/01_tables.sql",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const TABLES_SQL = Object.values(sqlSources)[0];

/** The three constraints this ledger governs (contract §8 rule 1). */
const TARGET_TYPE_CONSTRAINT_NAMES = [
  "tasks_target_type_check",
  "interactions_target_type_check",
  "entity_files_target_type_check",
] as const;

/**
 * Parses the quoted value list out of `constraint <name> check (target_type
 * in (...))` in a raw SQL source string. Returns `undefined` when the named
 * constraint is absent from the source (e.g. `entity_files` — the table
 * does not exist yet).
 */
export function extractTargetTypeCheckValues(
  sql: string,
  constraintName: string,
): string[] | undefined {
  const pattern = new RegExp(
    `constraint\\s+${constraintName}\\s+check\\s*\\(\\s*target_type\\s+in\\s*\\(([^)]*)\\)`,
    "i",
  );
  const match = pattern.exec(sql);
  if (!match) return undefined;
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value.length > 0);
}

/** True when every value in `values` also appears in `ENTITY_TARGET_TYPES`, AND vice versa. */
export function isAtParityWithEntityTargetTypes(values: string[]): boolean {
  const entityTypes: readonly string[] = ENTITY_TARGET_TYPES;
  return (
    values.every((value) => entityTypes.includes(value)) &&
    entityTypes.every((value) => values.includes(value))
  );
}

/** Every named constraint not (yet) excused by `PENDING_DB_WIDENINGS`. */
function findOffendingConstraints(
  pendingWidenings: readonly string[],
): string[] {
  const offenders: string[] = [];
  for (const name of TARGET_TYPE_CONSTRAINT_NAMES) {
    if (pendingWidenings.includes(name)) continue;
    const values = extractTargetTypeCheckValues(TABLES_SQL, name);
    if (!values) continue; // Not created yet — nothing to assert.
    if (!isAtParityWithEntityTargetTypes(values)) offenders.push(name);
  }
  return offenders;
}

describe("extractTargetTypeCheckValues — shown red then green", () => {
  it("returns undefined for a constraint absent from the source", () => {
    // Arrange
    const fixture = "constraint other_check check (status in ('a'))";

    // Act / Assert
    expect(
      extractTargetTypeCheckValues(fixture, "tasks_target_type_check"),
    ).toBeUndefined();
  });

  it("parses the real tasks_target_type_check values from 01_tables.sql", () => {
    // Act / Assert
    expect(
      extractTargetTypeCheckValues(TABLES_SQL, "tasks_target_type_check"),
    ).toEqual(["shadchan", "shidduch", "reference"]);
  });

  it("parses the real interactions_target_type_check values from 01_tables.sql (Story 3.5 widened it to all four ENTITY_TARGET_TYPES)", () => {
    // Act / Assert
    expect(
      extractTargetTypeCheckValues(
        TABLES_SQL,
        "interactions_target_type_check",
      ),
    ).toEqual(["reference", "shidduch", "shadchan", "single"]);
  });
});

describe("isAtParityWithEntityTargetTypes — shown red then green", () => {
  it("is false for a strict subset (today's tasks_target_type_check)", () => {
    // Act / Assert
    expect(isAtParityWithEntityTargetTypes(["shadchan", "shidduch"])).toBe(
      false,
    );
  });

  it("is false when a value is foreign to ENTITY_TARGET_TYPES (identity_signals' date_record)", () => {
    // Act / Assert
    expect(
      isAtParityWithEntityTargetTypes(["reference", "shidduch", "date_record"]),
    ).toBe(false);
  });

  it("is true for exactly the four ENTITY_TARGET_TYPES values, any order", () => {
    // Act / Assert
    expect(
      isAtParityWithEntityTargetTypes([
        "reference",
        "single",
        "shidduch",
        "shadchan",
      ]),
    ).toBe(true);
  });
});

describe("PENDING_DB_WIDENINGS guard", () => {
  it("reports no offenders today — every named constraint is honestly tracked as pending", () => {
    // Act / Assert
    expect(findOffendingConstraints(PENDING_DB_WIDENINGS)).toEqual([]);
  });

  /**
   * The red run contract §13 rule 2 requires: this is the "before" half,
   * proving the guard CAN fail. Removing an entry from a local copy of the
   * pending list (never the real constant) simulates forgetting to keep the
   * ledger honest. See Dev Agent Record -> Debug Log References for the
   * actual `npx vitest run` output captured from this exact assertion.
   */
  it("fails, naming the constraint, when tasks_target_type_check is removed from the pending list before its migration lands", () => {
    // Arrange
    const prematurelyNotPending = PENDING_DB_WIDENINGS.filter(
      (name) => name !== "tasks_target_type_check",
    );

    // Act
    const offenders = findOffendingConstraints(prematurelyNotPending);

    // Assert
    expect(offenders).toEqual(["tasks_target_type_check"]);
  });

  /**
   * interactions_target_type_check reached parity in Story 3.5 and is no
   * longer in PENDING_DB_WIDENINGS at all, so "remove it from the pending
   * list" (the shape the tasks_target_type_check test above uses) is a
   * no-op here — it is already absent. AC 6's own falsifiable claim is
   * instead: reverting the migration itself (the constraint's value list
   * back to its pre-Story-3.5 two values) turns the guard red. Proven
   * directly against the two lower-level functions the offender-scan is
   * built from, rather than re-deriving a fixture from the real schema
   * text.
   */
  it("interactions_target_type_check would fail parity again if its migration were reverted to the pre-Story-3.5 two-value constraint", () => {
    // Arrange — the exact pre-Story-3.5 constraint text (AC 1's falsifiable claim).
    const revertedFixture =
      "constraint interactions_target_type_check check (\n        target_type in ('reference', 'shidduch')\n    )";

    // Act
    const values = extractTargetTypeCheckValues(
      revertedFixture,
      "interactions_target_type_check",
    );

    // Assert
    expect(values).toEqual(["reference", "shidduch"]);
    expect(isAtParityWithEntityTargetTypes(values!)).toBe(false);
  });
});

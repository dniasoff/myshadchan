import { describe, expect, it } from "vitest";

/**
 * AC-3 (read-only) + AC-5 (never enumerates `references`): both are proven
 * here by scanning the raw source of the two files this story adds, the
 * same `?raw` idiom as `entity360/tabs/TasksRailSummary.guard.test.ts` and
 * `references/entitlementGate.guard.test.ts`.
 *
 * `useReminders` is scanned for separately from the mutation-hook list
 * (AC-3's own "Failing looks like" clause): a card that imported
 * `reminders/useReminders` instead of this story's own read-only hook would
 * pull in `useUpdate` from ANOTHER file's source, so scanning only for
 * `useCreate`/`useUpdate`/`useDelete`/`useMutation` in THIS file's text
 * would stay green while the guard's actual intent — no mutation reachable
 * from this card's own module — silently failed. Naming the import string
 * directly closes that gap.
 *
 * Shown red once, then green (contract §13 rule 2): `useDueReminders.ts`
 * briefly imported `useUpdate` from `ra-core` (unused) and this guard
 * failed, naming it — see the story's Dev Agent Record -> Debug Log
 * References for the captured `npx vitest run` output.
 */

const sources = import.meta.glob(
  "./{DueRemindersCard.tsx,useDueReminders.ts}",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const FORBIDDEN_MUTATION_HOOKS = [
  "useCreate",
  "useUpdate",
  "useDelete",
  "useMutation",
  "useReminders",
];

const FORBIDDEN_RESOURCE_NAMES = ['"references"', '"references_summary"'];

describe("DueRemindersCard + useDueReminders stay read-only and reference-free (AC-3, AC-5)", () => {
  it("has a non-empty set of sources to scan", () => {
    // Sanity check for the glob pattern itself (`TasksRailSummary.guard
    // .test.ts:39-45`'s own case) — if this ever fails, every assertion
    // below would pass vacuously against an empty object.
    const paths = Object.keys(sources);
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(typeof sources[path]).toBe("string");
      expect(sources[path].length).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(sources))(
    "%s references none of the forbidden mutation hooks / useReminders",
    (path) => {
      // Act
      const offenders = FORBIDDEN_MUTATION_HOOKS.filter((hook) =>
        new RegExp(`\\b${hook}\\b`).test(sources[path]),
      );

      // Assert
      expect(offenders, `${path} references: ${offenders.join(", ")}`).toEqual(
        [],
      );
    },
  );

  it.each(Object.keys(sources))(
    "%s never names the references / references_summary resource",
    (path) => {
      // Act — literal string match, deliberately covering the
      // `useGetMany`/`useGetOne` shapes the AD-24 validator itself does not
      // scan for (`ad24Conformance.ts:692-694`); this guard's "discipline,
      // not the guard" half.
      const offenders = FORBIDDEN_RESOURCE_NAMES.filter((name) =>
        sources[path].includes(name),
      );

      // Assert
      expect(offenders, `${path} names: ${offenders.join(", ")}`).toEqual([]);
    },
  );
});

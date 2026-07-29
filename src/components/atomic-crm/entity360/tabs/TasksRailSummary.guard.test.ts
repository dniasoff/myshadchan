import { describe, expect, it } from "vitest";

/**
 * Ruling 2 (contract §11): `TasksTab` is the ONLY component in the codebase
 * that mutates tasks from a 360 — `TasksRailSummary` must stay a read-only
 * summary forever, not just today. A behaviour test against a mocked data
 * provider cannot prove the absence of a mutation hook the component never
 * calls (there is no user action left to trigger it), so this scans the raw
 * source instead — the same `?raw` idiom as
 * `references/entitlementGate.guard.test.ts:16-20` — and fails loudly the
 * moment a copy-paste from `TasksTab.tsx` reintroduces `useCreate`,
 * `useUpdate`, `useDelete`, `useMutation`, or a form control.
 *
 * Shown red once, then green (contract §13 rule 2): `useCreate` was
 * temporarily imported and called in `TasksRailSummary.tsx` and this guard
 * failed, naming it, before being removed again — see the story's Dev Agent
 * Record -> Debug Log References for the captured `npx vitest run` output.
 */

const sources = import.meta.glob("./TasksRailSummary.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SOURCE = Object.values(sources)[0];

const FORBIDDEN_MUTATION_HOOKS = [
  "useCreate",
  "useUpdate",
  "useDelete",
  "useMutation",
];

// Form controls that would let a user write something — none of them belong
// in a read-only rail summary.
const FORBIDDEN_FORM_IMPORTS = ["Input", "Textarea", "Checkbox", "Button"];

describe("TasksRailSummary stays read-only (Ruling 2)", () => {
  it("has a source to scan", () => {
    // Sanity check for the glob pattern itself — if this ever fails, the
    // checks below would pass vacuously on an empty string.
    expect(typeof SOURCE).toBe("string");
    expect(SOURCE.length).toBeGreaterThan(0);
  });

  it("references none of the mutation hooks", () => {
    // Act
    const offenders = FORBIDDEN_MUTATION_HOOKS.filter((hook) =>
      SOURCE.includes(hook),
    );

    // Assert
    expect(
      offenders,
      `TasksRailSummary.tsx references: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("imports no form component", () => {
    // Act
    const offenders = FORBIDDEN_FORM_IMPORTS.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(SOURCE),
    );

    // Assert
    expect(
      offenders,
      `TasksRailSummary.tsx imports: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

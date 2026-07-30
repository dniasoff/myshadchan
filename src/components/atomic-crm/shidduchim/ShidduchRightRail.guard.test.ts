import { describe, expect, it } from "vitest";

/**
 * Ruling 2 (contract §11), AC 7: `entity360/tabs/TasksRailSummary.guard.
 * test.ts` scans exactly `TasksRailSummary.tsx` — it proves nothing about
 * the shidduch's own rail wrapper, which is where a re-introduced add/
 * complete affordance would actually live. This widens the scan to
 * `ShidduchRightRail.tsx` and its two bespoke panels, using the same `?raw`
 * idiom.
 *
 * Shown red once, then green (contract §13 rule 2): a temporary `useUpdate`
 * import in `ShidduchRightRail.tsx` made this guard fail, naming it, before
 * being removed again — see the story's Dev Agent Record -> Debug Log
 * References for the captured `npx vitest run` output.
 */

const sources = import.meta.glob(
  [
    "./ShidduchRightRail.tsx",
    "./SingleInputPanel.tsx",
    "./ForwardResumeButton.tsx",
  ],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const FORBIDDEN_MUTATION_HOOKS = [
  "useCreate",
  "useUpdate",
  "useDelete",
  "useMutation",
];

// Form controls that would let a user write DATA (a task, a note, an
// interaction) belong in a read-only rail never. Deliberately excludes
// "Button" — `TasksRailSummary.guard.test.ts` forbids it because a button
// there would almost certainly be an add/toggle affordance, but
// `ForwardResumeButton` legitimately renders one for a non-mutating
// action (a signed-URL download / OS share sheet, never a `useCreate`/
// `useUpdate`/`useDelete`/`useMutation` call — the hook check above already
// proves that).
const FORBIDDEN_FORM_IMPORTS = ["Input", "Textarea", "Checkbox"];

describe("The shidduch right rail stays read-only (Ruling 2, AC 7)", () => {
  it("has three sources to scan", () => {
    // Sanity check for the glob pattern itself — if this ever fails, the
    // checks below would pass vacuously on an empty set.
    expect(Object.keys(sources)).toHaveLength(3);
    for (const source of Object.values(sources)) {
      expect(typeof source).toBe("string");
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it("references none of the mutation hooks, in any of the three files", () => {
    for (const [file, source] of Object.entries(sources)) {
      // Act
      const offenders = FORBIDDEN_MUTATION_HOOKS.filter((hook) =>
        source.includes(hook),
      );

      // Assert
      expect(offenders, `${file} references: ${offenders.join(", ")}`).toEqual(
        [],
      );
    }
  });

  it("imports no form-input component, in any of the three files", () => {
    for (const [file, source] of Object.entries(sources)) {
      // Act
      const offenders = FORBIDDEN_FORM_IMPORTS.filter((name) =>
        new RegExp(`\\b${name}\\b`).test(source),
      );

      // Assert
      expect(offenders, `${file} imports: ${offenders.join(", ")}`).toEqual([]);
    }
  });
});

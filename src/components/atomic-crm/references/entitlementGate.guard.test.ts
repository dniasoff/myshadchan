import { describe, expect, it } from "vitest";

/**
 * The entitlement gate must stay narrow (E4 / FR63). AI is the ONLY paid
 * surface; everything else — the pipeline, references, timeline, notes,
 * reminders, call log, merge, catch/dedupe and match-on-entry — is free by
 * requirement and must NEVER consult the entitlement gate. A free feature that
 * imported useAiEntitlement would paywall something that must not be paywalled.
 *
 * This scans the whole atomic-crm source at build time (Vite inlines the files
 * as raw strings) and asserts that the only modules referencing the entitlement
 * hook are the small, expected allowlist. It fails loudly if any other file —
 * especially a free feature — starts importing it.
 */

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const basename = (path: string): string => path.split("/").pop() ?? path;

// The only files allowed to reference the entitlement hook: its own definition,
// the single paid surface it gates, and the Billing page that reports the plan.
const ALLOWED = new Set([
  "useAiEntitlement.ts",
  "ResearchAssistantPanel.tsx",
  "BillingPage.tsx",
]);

// A representative sample of free features that must remain gate-free. Names are
// checked as substrings of the referencing path, so a moved file is still caught.
const FREE_FEATURES_THAT_MUST_NOT_GATE = [
  "ReferenceMatchPanel",
  "ShidduchCatchPanel",
  "CallCaptureSheet",
  "ReferenceMergeButton",
  "Reminder",
  "Timeline",
  "NoteInputs",
];

const referencingFiles = Object.entries(sources)
  .filter(
    ([path, content]) =>
      // Ignore test files (this guard itself references the name in prose).
      !path.includes(".test.") &&
      !path.includes(".guard.") &&
      /useAiEntitlement/.test(content),
  )
  .map(([path]) => path);

describe("entitlement gate stays narrow", () => {
  it("is referenced only by the allowlisted modules", () => {
    // Arrange
    const offenders = referencingFiles.filter(
      (path) => !ALLOWED.has(basename(path)),
    );

    // Assert
    expect(
      offenders,
      `Unexpected modules reference useAiEntitlement: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("is never referenced by a free feature", () => {
    for (const feature of FREE_FEATURES_THAT_MUST_NOT_GATE) {
      // Assert — no free-feature file may consult the paid gate.
      const gated = referencingFiles.filter((path) => path.includes(feature));
      expect(
        gated,
        `Free feature ${feature} must not consult the entitlement gate`,
      ).toEqual([]);
    }
  });

  it("confirms the paid surface DOES gate (guard sanity check)", () => {
    // Arrange / Assert — if this ever fails, the panel stopped gating and the
    // scan above would be meaningless.
    const gatesTheAssistant = referencingFiles.some((path) =>
      path.includes("ResearchAssistantPanel"),
    );
    expect(gatesTheAssistant).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { ReferenceLinkSummary } from "../types";
import { buildCrossReferenceSummary } from "./crossReferenceSummary";

const link = (
  overrides: Partial<ReferenceLinkSummary> & { id: number },
): ReferenceLinkSummary =>
  ({
    call_status: "answered",
    conversation_log: [],
    conversation_log_count: 0,
    what_they_said: "",
    ...overrides,
  }) as ReferenceLinkSummary;

describe("buildCrossReferenceSummary", () => {
  it("separates references spoken to from those still outstanding", () => {
    // Arrange
    const links = [
      link({ id: 1, what_they_said: "Wonderful character, very warm." }),
      link({ id: 2, call_status: "no_answer", what_they_said: "" }),
      link({ id: 3, call_status: "not_started" }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.spokenTo.map((l) => l.id)).toEqual([1]);
    expect(summary.outstanding.map((l) => l.id)).toEqual([2, 3]);
  });

  it("reports which topics were covered and which are gaps", () => {
    // Arrange
    const links = [
      link({
        id: 1,
        what_they_said: "Excellent character and a lovely family home.",
      }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    const coveredIds = summary.covered.map((topic) => topic.id);
    const gapIds = summary.gaps.map((topic) => topic.id);
    expect(coveredIds).toContain("character");
    expect(coveredIds).toContain("family");
    expect(gapIds).toContain("health");
    expect(gapIds).toContain("learning");
  });

  it("reads the conversation log as well as the headline note", () => {
    // Arrange
    const links = [
      link({
        id: 1,
        what_they_said: "",
        conversation_log: [
          {
            at: "2026-01-01T10:00:00Z",
            source: "manual",
            text: "Spoke about his learning in yeshiva.",
          },
        ],
      }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.spokenTo).toHaveLength(1);
    expect(summary.covered.map((topic) => topic.id)).toContain("learning");
  });

  it("flags a contradiction when references pull in different directions", () => {
    // Arrange
    const links = [
      link({ id: 1, what_they_said: "A wonderful person, no reservations." }),
      link({
        id: 2,
        what_they_said: "Fine, but I have a concern about temperament.",
      }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.endorsements.map((l) => l.id)).toEqual([1]);
    expect(summary.reservations.map((l) => l.id)).toEqual([2]);
    expect(summary.hasContradiction).toBe(true);
  });

  it("does not flag a contradiction when everyone agrees", () => {
    // Arrange
    const links = [
      link({ id: 1, what_they_said: "Wonderful, warm, highly recommended." }),
      link({ id: 2, what_they_said: "An excellent young man." }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.hasContradiction).toBe(false);
    expect(summary.reservations).toHaveLength(0);
  });

  it("does not count a reserved reference as an endorsement", () => {
    // Arrange
    const links = [
      link({
        id: 1,
        what_they_said:
          "Wonderful in many ways, but I am worried about health.",
      }),
    ];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.endorsements).toHaveLength(0);
    expect(summary.reservations.map((l) => l.id)).toEqual([1]);
  });

  it("reports every topic as a gap when nobody has been reached", () => {
    // Arrange
    const links = [link({ id: 1, call_status: "no_answer" })];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(summary.covered).toHaveLength(0);
    expect(summary.gaps.length).toBeGreaterThan(0);
    expect(summary.hasContradiction).toBe(false);
  });

  it("never emits a verdict field about the match itself (FR63)", () => {
    // Arrange
    const links = [link({ id: 1, what_they_said: "Wonderful character." })];

    // Act
    const summary = buildCrossReferenceSummary(links);

    // Assert
    expect(Object.keys(summary)).toEqual([
      "spokenTo",
      "outstanding",
      "covered",
      "gaps",
      "endorsements",
      "reservations",
      "hasContradiction",
    ]);
  });
});

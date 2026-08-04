import { describe, expect, it } from "vitest";
import { deterministicNarrative, BANNED_PHRASES } from "./dossierNarrator";
import type { CrossReferenceSummary } from "./dossierFacts";

const coverageTopic = (id: string, label: string) => ({
  id,
  label,
  cues: [],
});

const emptyFacts: CrossReferenceSummary = {
  spokenTo: [],
  outstanding: [],
  covered: [],
  gaps: [coverageTopic("character", "Character")],
  endorsements: [],
  reservations: [],
  hasMixedSentiment: false,
};

const fullFacts = (): CrossReferenceSummary => ({
  spokenTo: [
    { id: 1 },
    { id: 2 },
  ] as unknown as CrossReferenceSummary["spokenTo"],
  outstanding: [{ id: 3 }] as unknown as CrossReferenceSummary["outstanding"],
  covered: [
    coverageTopic("character", "Character"),
    coverageTopic("family", "Family"),
  ],
  gaps: [coverageTopic("health", "Health")],
  endorsements: [{ id: 1 }] as unknown as CrossReferenceSummary["endorsements"],
  reservations: [{ id: 2 }] as unknown as CrossReferenceSummary["reservations"],
  hasMixedSentiment: true,
});

// Review fix (Finding 12): the free-form `claudeNarrator` this file used to
// also cover has been deleted (see dossierNarrator.ts's header comment for
// why), and its two tests deleted with it — including the one Finding 14
// proved vacuous (it patched a `.client` property the narrator never
// attached, so the patch silently no-op'd and the test called
// `deterministicNarrative` directly instead of exercising the real compose
// path). `deterministicNarrative` is now the dossier's only narrative
// implementation, and every one of its behaviors — including the fallback
// wording that used to be the *fallback* case — is exercised directly below,
// with no mock, no client, and nothing that can silently no-op.
describe("deterministicNarrative", () => {
  it("returns the 'nothing recorded' message when no references were spoken to", () => {
    // Arrange / Act
    const text = deterministicNarrative(emptyFacts);

    // Assert
    expect(text).toContain("Nothing has been recorded");
  });

  it("includes counts and topic labels for a full summary", () => {
    // Arrange / Act
    const text = deterministicNarrative(fullFacts());

    // Assert
    expect(text).toContain("2 references were spoken to");
    expect(text).toContain("1 spoke warmly");
    expect(text).toContain("1 raised a reservation");
    expect(text).toContain("Topics covered: Character, Family");
    expect(text).toContain("Still missing: Health");
    expect(text).toContain("1 conversation has not happened yet");
  });

  it("never contains a banned phrase for any fixture", () => {
    // Arrange
    const fixtures: CrossReferenceSummary[] = [
      emptyFacts,
      fullFacts(),
      {
        spokenTo: [{ id: 1 }] as unknown as CrossReferenceSummary["spokenTo"],
        outstanding: [],
        covered: [coverageTopic("character", "Character")],
        gaps: [],
        endorsements: [
          { id: 1 },
        ] as unknown as CrossReferenceSummary["endorsements"],
        reservations: [],
        hasMixedSentiment: false,
      },
    ];

    for (const facts of fixtures) {
      // Act
      const text = deterministicNarrative(facts);

      // Assert
      for (const phrase of BANNED_PHRASES) {
        expect(text.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});

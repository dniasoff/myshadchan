import type { ReferenceLinkSummary } from "../types";
import { getCallStatusDescriptor } from "./callStatus";

/**
 * Cross-reference summary (FR61): what several references said about the same
 * single, organized into consensus, contradictions and — the most useful one —
 * gaps.
 *
 * FR63 guardrail: this NEVER scores, ranks or recommends. It reports coverage
 * and where accounts disagree, and stops there. Any change that makes this
 * function emit a verdict about a match is a requirements violation, not a
 * feature.
 *
 * This module is deliberately pure and deterministic: the same links always
 * produce the same summary, with no model call involved. The paid assistant
 * layers phrasing on top of this, it does not replace it.
 */

export type CoverageTopic = {
  id: string;
  label: string;
  /** Words that suggest a reference actually addressed this topic. */
  cues: readonly string[];
};

/**
 * The topics a diligence call is expected to cover. Kept small and explicit:
 * a gap is only meaningful if the list of things you meant to ask is honest.
 */
export const COVERAGE_TOPICS: readonly CoverageTopic[] = [
  {
    id: "character",
    label: "Character",
    cues: [
      "character",
      "middos",
      "kind",
      "honest",
      "temperament",
      "personality",
    ],
  },
  {
    id: "family",
    label: "Family",
    cues: ["family", "parents", "siblings", "home", "mother", "father"],
  },
  {
    id: "learning",
    label: "Learning or work",
    cues: [
      "learning",
      "yeshiva",
      "seminary",
      "school",
      "work",
      "job",
      "career",
      "studies",
    ],
  },
  {
    id: "health",
    label: "Health",
    cues: ["health", "medical", "illness", "wellbeing"],
  },
  {
    id: "observance",
    label: "Observance",
    cues: ["observance", "frum", "shul", "religious", "hashkafa", "shabbos"],
  },
  {
    id: "social",
    label: "Friends and social",
    cues: ["friends", "social", "peers", "community", "outgoing", "shy"],
  },
] as const;

/** Phrases that read as reservation rather than endorsement. */
const HESITATION_CUES = [
  "but ",
  "however",
  "concern",
  "worried",
  "hesitat",
  "not sure",
  "unsure",
  "reserved about",
  "issue",
  "struggled",
  "difficult",
] as const;

const ENDORSEMENT_CUES = [
  "wonderful",
  "excellent",
  "very positive",
  "highly",
  "warm",
  "lovely",
  "outstanding",
  "no reservations",
  "special",
] as const;

export type CrossReferenceSummary = {
  /** Links whose call actually happened, and so carry usable testimony. */
  spokenTo: ReferenceLinkSummary[];
  /** Links still outstanding — the honest denominator for coverage. */
  outstanding: ReferenceLinkSummary[];
  /** Topics at least one reference addressed. */
  covered: CoverageTopic[];
  /** Topics nobody addressed. Usually the most actionable part. */
  gaps: CoverageTopic[];
  /** References that read as warm endorsements. */
  endorsements: ReferenceLinkSummary[];
  /** References that voiced some reservation. */
  reservations: ReferenceLinkSummary[];
  /**
   * True when references pull in different directions — some warm, some
   * reserved. Surfaced so the user reads both, never resolved for them.
   */
  hasContradiction: boolean;
};

const textOf = (link: ReferenceLinkSummary): string => {
  const logText = (link.conversation_log ?? [])
    .map((entry) => entry.text ?? "")
    .join(" ");
  return `${link.what_they_said ?? ""} ${logText}`.toLowerCase();
};

const matchesAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

export const buildCrossReferenceSummary = (
  links: ReadonlyArray<ReferenceLinkSummary>,
): CrossReferenceSummary => {
  const spokenTo = links.filter(
    (link) =>
      getCallStatusDescriptor(link.call_status).isContacted &&
      textOf(link).trim() !== "",
  );
  const outstanding = links.filter(
    (link) => !getCallStatusDescriptor(link.call_status).isContacted,
  );

  const corpus = spokenTo.map(textOf);

  const covered = COVERAGE_TOPICS.filter((topic) =>
    corpus.some((text) => matchesAny(text, topic.cues)),
  );
  const gaps = COVERAGE_TOPICS.filter((topic) => !covered.includes(topic));

  const reservations = spokenTo.filter((link) =>
    matchesAny(textOf(link), HESITATION_CUES),
  );
  const endorsements = spokenTo.filter(
    (link) =>
      matchesAny(textOf(link), ENDORSEMENT_CUES) &&
      !matchesAny(textOf(link), HESITATION_CUES),
  );

  return {
    spokenTo,
    outstanding,
    covered,
    gaps,
    endorsements,
    reservations,
    hasContradiction: endorsements.length > 0 && reservations.length > 0,
  };
};

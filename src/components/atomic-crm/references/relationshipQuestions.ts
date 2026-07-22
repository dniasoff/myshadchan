/**
 * Tailored diligence questions by relationship type (FR59).
 *
 * A seminary teacher, a neighbour and a childhood friend each know a different
 * slice of a person, so asking all three the same list wastes the call. These
 * templates are static content, not model output — the paid assistant (FR60)
 * uses them as the spine of its guided script, but they work without it, which
 * is why the call script itself is never behind the paywall.
 *
 * FR63 guardrail: every question asks what the reference OBSERVED. None asks
 * the reference to assess whether the match is a good idea.
 */

export type RelationshipQuestionSet = {
  id: string;
  label: string;
  /** Substrings matched (case-insensitively) against references.relationship. */
  cues: readonly string[];
  questions: readonly string[];
};

const UNIVERSAL_QUESTIONS = [
  "How long have you known them, and in what setting?",
  "How would you describe them to someone who has never met them?",
  "Is there anything you think we should know that we have not asked about?",
] as const;

export const RELATIONSHIP_QUESTION_SETS: readonly RelationshipQuestionSet[] = [
  {
    id: "teacher",
    label: "Teacher or rebbe",
    cues: ["teacher", "rebbe", "rabbi", "morah", "principal", "mechanech"],
    questions: [
      "How did they handle a subject or a situation they found difficult?",
      "How did they get on with peers in the classroom?",
      "Did they take responsibility when something went wrong?",
      "How consistent were they over the years you taught them?",
    ],
  },
  {
    id: "neighbour",
    label: "Neighbour",
    cues: ["neighbour", "neighbor", "shul", "community"],
    questions: [
      "What is the home like day to day?",
      "How do they treat people who cannot do anything for them?",
      "How do the family get on with the people around them?",
      "Have you seen them under pressure, and how did they handle it?",
    ],
  },
  {
    id: "friend",
    label: "Friend",
    cues: ["friend", "chavrusa", "roommate", "classmate"],
    questions: [
      "What do they do when a friend needs something inconvenient?",
      "How do they handle disagreement?",
      "What do they spend their free time on?",
      "Has anything about them changed in the last few years?",
    ],
  },
  {
    id: "employer",
    label: "Employer or colleague",
    cues: ["employer", "boss", "manager", "colleague", "work"],
    questions: [
      "How reliable were they with commitments and deadlines?",
      "How did they work with people they disagreed with?",
      "How did they respond to being corrected?",
    ],
  },
  {
    id: "family_friend",
    label: "Family friend",
    cues: ["family friend", "family", "relative", "cousin", "aunt", "uncle"],
    questions: [
      "How do they relate to their parents and siblings?",
      "What is the family's approach to the things that matter to them?",
      "What have you seen of them in the home that others would not?",
    ],
  },
] as const;

/**
 * Picks the closest question set for a relationship label. Falls back to the
 * universal questions when the relationship is blank or unrecognised, so the
 * call script is never empty.
 */
export const getQuestionsForRelationship = (
  relationship?: string | null,
): { set: RelationshipQuestionSet | null; questions: string[] } => {
  const normalized = (relationship ?? "").trim().toLowerCase();

  const set =
    normalized === ""
      ? null
      : (RELATIONSHIP_QUESTION_SETS.find((candidate) =>
          candidate.cues.some((cue) => normalized.includes(cue)),
        ) ?? null);

  return {
    set,
    questions: [...(set?.questions ?? []), ...UNIVERSAL_QUESTIONS],
  };
};

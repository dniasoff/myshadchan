import { getQuestionsForRelationship } from "./relationshipQuestions";

/**
 * Builds the guided call script for a given relationship.
 *
 * The ids are session-scoped by design (nothing persists them), so they need
 * no stability guarantee across releases. They are deterministic within a
 * single session: `${set?.id ?? "universal"}.${index}`.
 */
export type CallScriptStep = {
  id: string;
  question: string;
};

export function buildCallScript(
  relationship?: string | null,
): CallScriptStep[] {
  const { set, questions } = getQuestionsForRelationship(relationship);
  const setId = set?.id ?? "universal";

  return questions.map((question, index) => ({
    id: `${setId}.${index}`,
    question,
  }));
}

import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_QUESTION_SETS,
  getQuestionsForRelationship,
} from "./relationshipQuestions";

describe("getQuestionsForRelationship", () => {
  it("tailors the questions to a teacher", () => {
    // Arrange / Act
    const { set, questions } = getQuestionsForRelationship("seminary teacher");

    // Assert
    expect(set?.id).toBe("teacher");
    expect(questions.some((q) => q.includes("classroom"))).toBe(true);
  });

  it("matches on a cue anywhere in the relationship label", () => {
    // Arrange / Act
    const { set } = getQuestionsForRelationship("Our next-door neighbour");

    // Assert
    expect(set?.id).toBe("neighbour");
  });

  it("is case insensitive", () => {
    // Arrange / Act
    const { set } = getQuestionsForRelationship("CHAVRUSA");

    // Assert
    expect(set?.id).toBe("friend");
  });

  it("gives a different set to a friend than to a teacher", () => {
    // Arrange / Act
    const teacher = getQuestionsForRelationship("rebbe");
    const friend = getQuestionsForRelationship("close friend");

    // Assert
    expect(teacher.set?.id).not.toBe(friend.set?.id);
    expect(teacher.questions).not.toEqual(friend.questions);
  });

  it("always appends the universal questions", () => {
    // Arrange / Act
    const { questions } = getQuestionsForRelationship("employer");

    // Assert
    expect(questions.at(-1)).toContain("anything you think we should know");
  });

  it("falls back to the universal questions when the relationship is blank", () => {
    // Arrange / Act
    const { set, questions } = getQuestionsForRelationship("");

    // Assert
    expect(set).toBeNull();
    expect(questions).toHaveLength(3);
  });

  it("falls back rather than guessing for an unrecognised relationship", () => {
    // Arrange / Act
    const { set, questions } = getQuestionsForRelationship("dog walker");

    // Assert
    expect(set).toBeNull();
    expect(questions.length).toBeGreaterThan(0);
  });

  it("asks only about what the reference observed, never for a verdict", () => {
    // Arrange
    const verdictWords = [
      "should they",
      "good match",
      "recommend the match",
      "suitable",
    ];

    // Act
    const everyQuestion = RELATIONSHIP_QUESTION_SETS.flatMap(
      (set) => set.questions,
    );

    // Assert
    for (const question of everyQuestion) {
      for (const word of verdictWords) {
        expect(question.toLowerCase()).not.toContain(word);
      }
    }
  });
});

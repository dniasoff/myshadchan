import { describe, expect, it } from "vitest";

import type { PipelineState } from "../types";
import { PIPELINE_STATES, PIPELINE_TRANSITIONS } from "./pipelineStates";
import {
  buildPipelineStateOptions,
  classifySelection,
  isTerminalPipelineState,
} from "./useShidduchTransition";

/**
 * Task 9: the legality/reason table as a pure unit, asserted against
 * PIPELINE_TRANSITIONS directly so it cannot drift from transition_shidduch().
 * No React harness needed — buildPipelineStateOptions is a pure function.
 */

const ALL_STATES = PIPELINE_STATES.map((s) => s.value);

describe("isTerminalPipelineState — derived from PIPELINE_TRANSITIONS, not hardcoded", () => {
  it("is true for exactly the states with zero outgoing edges (for_sure_not, yes, unsure, no)", () => {
    // Arrange
    const expectedTerminal = ALL_STATES.filter(
      (state) => !PIPELINE_TRANSITIONS.some((t) => t.from_state === state),
    );

    // Act
    const actualTerminal = ALL_STATES.filter(isTerminalPipelineState);

    // Assert
    expect(actualTerminal.sort()).toEqual(expectedTerminal.sort());
    expect(actualTerminal.sort()).toEqual(
      ["for_sure_not", "no", "unsure", "yes"].sort(),
    );
  });
});

describe("buildPipelineStateOptions — the decorated seven-state table (AC-8)", () => {
  it("marks exactly {yes, unsure, no} as allowed from look_into", () => {
    // Arrange / Act
    const options = buildPipelineStateOptions("look_into");

    // Assert
    const allowed = options.filter((o) => o.isAllowed).map((o) => o.state);
    expect(allowed.sort()).toEqual(["no", "unsure", "yes"].sort());
    expect(options.find((o) => o.state === "look_into")?.isCurrent).toBe(true);
  });

  it("marks nothing as allowed from a terminal state (no)", () => {
    // Arrange / Act
    const options = buildPipelineStateOptions("no");

    // Assert
    expect(options.every((o) => o.isCurrent || !o.isAllowed)).toBe(true);
  });

  it("gives every non-current, non-allowed row a visible reason", () => {
    // Arrange / Act
    const options = buildPipelineStateOptions("new");

    // Assert
    for (const option of options) {
      if (option.isCurrent || option.isAllowed) continue;
      expect(option.reason).toBeTruthy();
    }
  });

  it("flags for_sure_not, yes, unsure and no as terminal, and nothing else", () => {
    // Arrange / Act
    const options = buildPipelineStateOptions("new");

    // Assert
    const terminal = options.filter((o) => o.isTerminal).map((o) => o.state);
    expect(terminal.sort()).toEqual(
      ["for_sure_not", "no", "unsure", "yes"].sort(),
    );
  });

  it("covers all seven canonical states in PIPELINE_STATES order", () => {
    // Arrange / Act
    const options = buildPipelineStateOptions("new");

    // Assert
    expect(options.map((o) => o.state)).toEqual(ALL_STATES);
  });
});

describe("classifySelection — the shared tap-outcome branching (AC-8, AC-9)", () => {
  const optionFor = (currentState: PipelineState, target: PipelineState) =>
    buildPipelineStateOptions(currentState).find((o) => o.state === target)!;

  it("is 'noop' for the current state", () => {
    expect(classifySelection(optionFor("new", "new"))).toBe("noop");
  });

  it("is 'warn' for an illegal, non-current destination", () => {
    expect(classifySelection(optionFor("new", "yes"))).toBe("warn");
  });

  it("is 'confirm' for a legal terminal destination", () => {
    expect(classifySelection(optionFor("look_into", "yes"))).toBe("confirm");
  });

  it("is 'move' for a legal non-terminal destination", () => {
    expect(classifySelection(optionFor("new", "look_into"))).toBe("move");
  });
});

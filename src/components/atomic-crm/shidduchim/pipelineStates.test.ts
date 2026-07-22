import type { PipelineState } from "../types";
import {
  CHILD_VISIBLE_STATES,
  INITIAL_PIPELINE_STATES,
  isChildVisibleState,
  isValidTransition,
  PIPELINE_STATE_VALUES,
  PIPELINE_STATES,
  PIPELINE_TRANSITIONS,
} from "./pipelineStates";

const ALL_STATES: PipelineState[] = [
  "new",
  "look_into",
  "not_sure",
  "for_sure_not",
  "yes",
  "unsure",
  "no",
];

describe("pipeline states", () => {
  it("declares exactly the 7 canonical states in board order", () => {
    // Arrange / Act
    const values = PIPELINE_STATE_VALUES;
    // Assert
    expect(values).toEqual(ALL_STATES);
    expect(PIPELINE_STATES).toHaveLength(7);
  });

  it("keeps gut for_sure_not and post-investigation no on distinct tokens (FR16)", () => {
    const fsn = PIPELINE_STATES.find((s) => s.value === "for_sure_not");
    const no = PIPELINE_STATES.find((s) => s.value === "no");
    expect(fsn?.token).toBe("--st-fsn");
    expect(no?.token).toBe("--st-no");
    expect(fsn?.token).not.toBe(no?.token);
  });
});

describe("isValidTransition", () => {
  it("allows the documented triage transitions", () => {
    expect(isValidTransition("new", "look_into")).toBe(true);
    expect(isValidTransition("new", "not_sure")).toBe(true);
    expect(isValidTransition("new", "for_sure_not")).toBe(true);
    expect(isValidTransition("not_sure", "look_into")).toBe(true);
    expect(isValidTransition("not_sure", "for_sure_not")).toBe(true);
  });

  it("makes decision states reachable ONLY from look_into", () => {
    // From look_into: allowed
    expect(isValidTransition("look_into", "yes")).toBe(true);
    expect(isValidTransition("look_into", "unsure")).toBe(true);
    expect(isValidTransition("look_into", "no")).toBe(true);
    // From any non-look_into triage state: forbidden
    for (const decision of ["yes", "unsure", "no"] as PipelineState[]) {
      expect(isValidTransition("new", decision)).toBe(false);
      expect(isValidTransition("not_sure", decision)).toBe(false);
      expect(isValidTransition("for_sure_not", decision)).toBe(false);
    }
  });

  it("treats for_sure_not, yes, unsure, no as terminal (no outgoing edges)", () => {
    const terminals: PipelineState[] = ["for_sure_not", "yes", "unsure", "no"];
    for (const from of terminals) {
      for (const to of ALL_STATES) {
        if (from === to) continue;
        expect(isValidTransition(from, to)).toBe(false);
      }
    }
  });

  it("treats a same-state move as valid (reorder within a column)", () => {
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(true);
    }
  });

  it("has every transition originate from new, not_sure, or look_into only", () => {
    const originStates = new Set(PIPELINE_TRANSITIONS.map((t) => t.from_state));
    expect([...originStates].sort()).toEqual(["look_into", "new", "not_sure"]);
  });
});

describe("INITIAL_PIPELINE_STATES", () => {
  it("permits creation only in triage states, never a decision state", () => {
    expect(INITIAL_PIPELINE_STATES).toEqual([
      "new",
      "look_into",
      "not_sure",
      "for_sure_not",
    ]);
    for (const decision of ["yes", "unsure", "no"] as PipelineState[]) {
      expect(INITIAL_PIPELINE_STATES).not.toContain(decision);
    }
  });
});

describe("child visibility (closed enumeration, AD-3/D5)", () => {
  it("classifies all 7 states explicitly with no gap", () => {
    // Arrange / Act
    const keys = Object.keys(CHILD_VISIBLE_STATES).sort();
    // Assert
    expect(keys).toEqual([...ALL_STATES].sort());
  });

  it("shows the child only look_into, yes, and unsure", () => {
    expect(isChildVisibleState("look_into")).toBe(true);
    expect(isChildVisibleState("yes")).toBe(true);
    expect(isChildVisibleState("unsure")).toBe(true);
  });

  it("hides new, not_sure, for_sure_not, and no from the child", () => {
    expect(isChildVisibleState("new")).toBe(false);
    expect(isChildVisibleState("not_sure")).toBe(false);
    expect(isChildVisibleState("for_sure_not")).toBe(false);
    expect(isChildVisibleState("no")).toBe(false);
  });
});

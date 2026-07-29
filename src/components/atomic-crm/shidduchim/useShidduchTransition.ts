import { useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { PipelineState } from "../types";
import {
  getPipelineStateDef,
  isValidTransition,
  PIPELINE_STATES,
  PIPELINE_TRANSITIONS,
  type PipelineGroup,
} from "./pipelineStates";

const DECISION_STATES: PipelineState[] = ["yes", "unsure", "no"];

/**
 * A pipeline state with zero outgoing edges in PIPELINE_TRANSITIONS (AC-9):
 * for_sure_not | yes | unsure | no today. Derived from the transition graph
 * itself — never a second hardcoded list — so this cannot silently drift if
 * the graph ever changes (useShidduchTransition.test.ts asserts it against
 * PIPELINE_TRANSITIONS directly).
 */
export const isTerminalPipelineState = (state: PipelineState): boolean =>
  !PIPELINE_TRANSITIONS.some((t) => t.from_state === state);

export interface PipelineStateOption {
  state: PipelineState;
  label: string;
  group: PipelineGroup;
  isCurrent: boolean;
  isAllowed: boolean;
  isTerminal: boolean;
  /** Explanatory sentence for a row that is neither current nor allowed (AC-8). */
  reason?: string;
}

const reasonFor = (from: PipelineState, to: PipelineState): string =>
  DECISION_STATES.includes(to)
    ? "Only reachable from Look-into."
    : `Not reachable from ${getPipelineStateDef(from)?.label ?? from}.`;

/**
 * The pure decorated option table (AC-8), independent of any React/data-
 * provider context — the "legality/reason table as a pure unit" Task 9 asks
 * for. All seven states, in canonical order, each carrying whether it's the
 * current state, whether isValidTransition() allows moving to it, whether
 * it's a terminal destination (AC-9), and — for a row that is neither — the
 * same reason sentence the pre-refactor notify() warning used.
 */
export const buildPipelineStateOptions = (
  currentState: PipelineState,
): PipelineStateOption[] =>
  PIPELINE_STATES.map((def) => {
    const isCurrent = def.value === currentState;
    const isAllowed = !isCurrent && isValidTransition(currentState, def.value);
    return {
      state: def.value,
      label: def.label,
      group: def.group,
      isCurrent,
      isAllowed,
      isTerminal: isTerminalPipelineState(def.value),
      reason:
        !isCurrent && !isAllowed
          ? reasonFor(currentState, def.value)
          : undefined,
    };
  });

/**
 * What tapping a row should do next (AC-8/AC-9) — the one piece of shared
 * branching logic both `ShidduchMoveSheet` and the refactored
 * `ShidduchStateControl` apply after a tap, kept here so it cannot drift
 * between the two surfaces (AD-4 — one transition guard).
 */
export type SelectionOutcome = "noop" | "warn" | "confirm" | "move";

export const classifySelection = (
  option: PipelineStateOption,
): SelectionOutcome => {
  if (option.isCurrent) return "noop";
  if (!option.isAllowed) return "warn";
  if (option.isTerminal) return "confirm";
  return "move";
};

export interface UseShidduchTransitionResult {
  /** All seven states, decorated for the vertical option list (AC-8). */
  options: PipelineStateOption[];
  /** The destination currently being written, or null between moves. */
  pendingTo: PipelineState | null;
  /**
   * Moves `id` from its current state to `to`. Verbatim `handleMove` logic
   * from the pre-refactor `ShidduchStateControl`: the same isValidTransition
   * guard, the same notify() warning string, the same refresh() on success.
   * `closeReason` (AC-9) forwards to `transitionShidduch`'s existing 4th
   * argument — no provider, type, schema or migration change.
   */
  move: (to: PipelineState, closeReason?: string) => Promise<void>;
}

/**
 * The move primitive (Task 5): the legality guard, the write call, and the
 * decorated option table every state-change surface in the app shares
 * (`ShidduchStateControl`, `ShidduchMoveSheet`). AD-4 invariant 2 stays
 * true — `dataProvider.transitionShidduch` remains the sole writer of
 * `pipeline_state`; this hook adds a second surface onto that one write
 * path, never a second one.
 */
export const useShidduchTransition = ({
  id,
  currentState,
  name,
}: {
  id: Identifier;
  currentState: PipelineState;
  name?: string | null;
}): UseShidduchTransitionResult => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [pendingTo, setPendingTo] = useState<PipelineState | null>(null);

  const move = async (to: PipelineState, closeReason?: string) => {
    if (to === currentState || pendingTo) return;

    if (!isValidTransition(currentState, to)) {
      const fromDef = getPipelineStateDef(currentState);
      const toDef = getPipelineStateDef(to);
      const decisionHint = DECISION_STATES.includes(to)
        ? " A decision (Yes / Unsure / No) can only be made from Look-into."
        : "";
      notify(
        `Can't move ${name ?? "this shidduch"} from ${
          fromDef?.label ?? currentState
        } to ${toDef?.label ?? to}.${decisionHint}`,
        { type: "warning" },
      );
      return;
    }

    setPendingTo(to);
    try {
      await dataProvider.transitionShidduch(id, currentState, to, closeReason);
      notify(`Moved to ${getPipelineStateDef(to)?.label ?? to}`, {
        type: "info",
      });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to move shidduch",
        { type: "error" },
      );
    } finally {
      setPendingTo(null);
    }
  };

  return { options: buildPipelineStateOptions(currentState), pendingTo, move };
};

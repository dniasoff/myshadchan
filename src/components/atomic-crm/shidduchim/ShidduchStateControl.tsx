import { useState } from "react";
import type { Identifier } from "ra-core";

import type { PipelineState } from "../types";
import { PipelineStateOptions } from "./PipelineStateOptions";
import { TerminalMoveConfirm } from "./TerminalMoveConfirm";
import type { PipelineStateOption } from "./useShidduchTransition";
import {
  classifySelection,
  useShidduchTransition,
} from "./useShidduchTransition";

/**
 * The state-transition control (Screen 18 body). Renders all 7 states via
 * `PipelineStateOptions` (Task 5) — the same group-labelled options
 * `ShidduchMoveSheet` uses, in its `row` orientation.
 *
 * Row, not list: the list form stacked seven full-width rows and cost ~750px
 * on this page, so the Shidduch facts, the resume and the single's input all
 * began below the fold on a laptop — a control you touch a handful of times
 * per suggestion pushing down everything you actually read. This is NOT a
 * return to the pre-story `flex flex-wrap` row of 7 chips that AC-8 replaced:
 * that one lost the TRIAGE/DECISION grouping and the "· final" marking, and
 * ran the pipeline's order across 3 ragged rows. Both survive here — the
 * groups are still labelled and still ordered, `· final` is still shown
 * before the tap, and legality still never hides a row. Legality still comes from `isValidTransition()`
 * (`useShidduchTransition` → `pipelineStates.ts`) — the DB's
 * `transition_shidduch()` RPC remains the enforcing authority, this is the
 * friendly client mirror. Public props are unchanged (Story 5.1 mounts this
 * exact component, with this exact signature, inside `EntityShow`'s
 * `actions` region).
 */
export const ShidduchStateControl = ({
  id,
  currentState,
  name,
}: {
  id: Identifier;
  currentState: PipelineState;
  name?: string | null;
}) => {
  const { options, pendingTo, move } = useShidduchTransition({
    id,
    currentState,
    name,
  });
  const [confirmState, setConfirmState] = useState<PipelineState | null>(null);

  const handleSelect = (option: PipelineStateOption) => {
    const outcome = classifySelection(option);
    if (outcome === "noop") return;
    if (outcome === "warn") {
      void move(option.state);
      return;
    }
    if (outcome === "confirm") {
      setConfirmState(option.state);
      return;
    }
    void move(option.state);
  };

  const handleConfirm = (reason?: string) => {
    if (!confirmState) return;
    void move(confirmState, reason);
    setConfirmState(null);
  };

  return (
    <section
      data-tour="state-control"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <h3 className="mb-3 font-display text-lg font-semibold">
        Move through the pipeline
      </h3>
      <PipelineStateOptions
        options={options}
        pendingTo={pendingTo}
        onSelect={handleSelect}
        orientation="row"
      />
      <TerminalMoveConfirm
        toState={confirmState}
        name={name}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirm}
      />
    </section>
  );
};

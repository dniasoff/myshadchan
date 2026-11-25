import { useState } from "react";
import type { Identifier } from "ra-core";

import type { PipelineState } from "../types";
import { Button } from "@/components/ui/button";
import { PipelineStateOptions } from "./PipelineStateOptions";
import { getPipelineStateDef } from "./pipelineStates";
import { ShidduchMoveBackConfirm } from "./ShidduchMoveBackConfirm";
import { TerminalMoveConfirm } from "./TerminalMoveConfirm";
import type { PipelineStateOption } from "./useShidduchTransition";
import {
  classifySelection,
  useShidduchTransition,
} from "./useShidduchTransition";
import { useShidduchMoveBack } from "./useShidduchMoveBack";

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
  const moveBack = useShidduchMoveBack(id);
  const { options, pendingTo, move } = useShidduchTransition({
    id,
    currentState,
    name,
    onMoved: () => void moveBack.reload(),
  });
  const [confirmState, setConfirmState] = useState<PipelineState | null>(null);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

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
      data-shidduch-id={String(id)}
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
      {moveBack.loading ? null : moveBack.loadError ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-muted-foreground">
            {moveBack.loadError} Try again to check whether this suggestion can
            move back.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void moveBack.reload()}
          >
            Try again
          </Button>
        </div>
      ) : moveBack.move ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Last move can be reversed.</span> You
            can move this suggestion back one step.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setBackConfirmOpen(true)}
            disabled={moveBack.busy}
          >
            Back to{" "}
            {getPipelineStateDef(moveBack.move.from_state)?.label ??
              moveBack.move.from_state}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing to move back yet.
        </p>
      )}
      <TerminalMoveConfirm
        toState={confirmState}
        name={name}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirm}
      />
      <ShidduchMoveBackConfirm
        move={backConfirmOpen ? moveBack.move : null}
        name={name}
        busy={moveBack.busy}
        onCancel={() => setBackConfirmOpen(false)}
        onConfirm={() => {
          void moveBack.moveBack();
          setBackConfirmOpen(false);
        }}
      />
    </section>
  );
};

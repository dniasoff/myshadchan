import { Plus } from "lucide-react";
import { Link } from "react-router";

import { buildNewPath } from "../entity360/entityPaths";
import type { PipelineState, ShidduchSummary } from "../types";
import {
  INITIAL_PIPELINE_STATES,
  type PipelineStateDef,
} from "./pipelineStates";
import { ShidduchRow } from "./ShidduchRow";

// Kept identical to (but not imported from) PipelineJumpBar.tsx's own
// private copy — see that file's comment: a file exporting a component
// cannot also export a plain function without tripping
// react-refresh/only-export-components, and this one-line DOM id format is
// not worth a third, non-component-only module just to share it.
const pipelineSectionId = (state: PipelineState): string =>
  `pipeline-section-${state}`;

export interface PipelineSectionProps {
  state: PipelineStateDef;
  shidduchim: ShidduchSummary[];
  onMove: (shidduch: ShidduchSummary) => void;
  /** "list" (default, stacked rows) or "cards" (a non-draggable grid) — the
   * same `ShidduchRow` content either way (Task 4). */
  variant?: "list" | "cards";
  /**
   * Task 8: anchors the tour's "pipeline-column"/"add-suggestion" steps on
   * this section (and "pipeline-card" on its first row) when this is the
   * first section rendered — the List/Cards-position counterpart to
   * `ShidduchColumn`'s own `tourAnchor` prop, so the tour has a valid target
   * whichever position happens to be active.
   */
  tourAnchor?: boolean;
}

/**
 * AC-7: one section per `PIPELINE_STATES` entry — a `<section>` with an
 * accessible name equal to the state label (what `e2e/pipeline.spec.ts`
 * targets via `getByRole("region", { name: /New/ })`), a sticky header
 * carrying the label and a live count, its rows, and `＋ Add here` for the
 * four `INITIAL_PIPELINE_STATES` only. A zero-count section still renders
 * its header, plus one note line instead of rows.
 */
export const PipelineSection = ({
  state,
  shidduchim,
  onMove,
  variant = "list",
  tourAnchor = false,
}: PipelineSectionProps) => {
  const canAdd = INITIAL_PIPELINE_STATES.includes(state.value);
  const count = shidduchim.length;

  return (
    <section
      id={pipelineSectionId(state.value)}
      aria-label={state.label}
      data-slot="pipeline-section"
      data-tour={tourAnchor ? "pipeline-column" : undefined}
      className="flex scroll-mt-(--mobile-header-h) flex-col"
    >
      <div
        className="sticky top-(--mobile-header-h) z-10 flex items-center gap-2
          border-b bg-background/95 px-1 py-2 backdrop-blur-sm"
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: `var(${state.token})` }}
        />
        <h3 className="text-sm font-semibold">{state.label}</h3>
        <span className="min-w-[22px] rounded-full bg-secondary px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
        {canAdd ? (
          <Link
            to={`${buildNewPath("shidduchim")}?state=${state.value}`}
            data-tour={tourAnchor ? "add-suggestion" : undefined}
            className="ms-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-2
              text-xs font-medium text-muted-foreground transition-colors
              hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add here
          </Link>
        ) : null}
      </div>

      {count === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">
          {state.note ?? "Nothing here yet."}
        </p>
      ) : variant === "cards" ? (
        <div className="grid grid-cols-1 gap-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {shidduchim.map((shidduch, index) => (
            <ShidduchRow
              key={shidduch.id}
              shidduch={shidduch}
              onMove={() => onMove(shidduch)}
              layout="card"
              tourAnchor={tourAnchor && index === 0}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y">
          {shidduchim.map((shidduch, index) => (
            <ShidduchRow
              key={shidduch.id}
              shidduch={shidduch}
              onMove={() => onMove(shidduch)}
              tourAnchor={tourAnchor && index === 0}
            />
          ))}
        </div>
      )}
    </section>
  );
};

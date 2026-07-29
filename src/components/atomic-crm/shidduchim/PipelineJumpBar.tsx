import { cn } from "@/lib/utils";

import type { PipelineState } from "../types";
import { PIPELINE_GROUPS, PIPELINE_STATES } from "./pipelineStates";

// Not exported: a file exporting both a component and a plain function trips
// react-refresh/only-export-components (ESLint, max-warnings=0). PipelineSection.tsx
// keeps its own identical one-liner rather than importing this — the DOM id
// format (`pipeline-section-${state}`) is the shared contract both files
// agree on, not logic worth a cross-file dependency for one template string.
const pipelineSectionId = (state: PipelineState): string =>
  `pipeline-section-${state}`;

/**
 * Review fix F1: this used to be `<a href="#pipeline-section-…">`. The app
 * runs on ra-core's default HashRouter, so `location.hash` IS the route —
 * setting it to a bare fragment replaced `#/shidduchim` with
 * `#pipeline-section-new`, unmounting the whole pipeline instead of
 * scrolling. A `<button>` that scrolls the target section into view is a
 * table of contents that cannot ever be mistaken for a route change (no
 * `href`, so no HashRouter interaction — including no stray middle-click/
 * open-in-new-tab onto a broken hash).
 */
const scrollToSection = (state: PipelineState): void => {
  document
    .getElementById(pipelineSectionId(state))
    ?.scrollIntoView({ block: "start" });
};

export interface PipelineJumpBarProps {
  counts: Partial<Record<PipelineState, number>>;
}

/**
 * AC-7: a labelled table of contents above the sections — 4 `triage` cells
 * on one row, 3 `decision` cells on the next, matching `PIPELINE_GROUPS`.
 * Deliberately NOT sticky and NOT a mode switch: a mis-tap here costs a
 * scroll, nothing more. A single 7-cell row cannot carry readable labels at
 * a 358px gutter; wrapping into two grouped rows is what buys the labels.
 */
export const PipelineJumpBar = ({ counts }: PipelineJumpBarProps) => (
  <nav aria-label="Jump to a stage" className="flex flex-col gap-2">
    {PIPELINE_GROUPS.map((group) => {
      const states = PIPELINE_STATES.filter((s) => s.group === group.id);
      return (
        <div
          key={group.id}
          className={cn(
            "grid gap-2",
            group.id === "triage" ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          {states.map((state) => (
            <button
              key={state.value}
              type="button"
              onClick={() => scrollToSection(state.value)}
              className="flex min-h-11 flex-col items-center justify-center gap-0.5
                rounded-xl border px-1 py-1.5 text-center transition-colors
                hover:bg-secondary focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-background"
            >
              <span className="text-[11px] font-semibold leading-tight">
                {state.label}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {counts[state.value] ?? 0}
              </span>
            </button>
          ))}
        </div>
      );
    })}
  </nav>
);

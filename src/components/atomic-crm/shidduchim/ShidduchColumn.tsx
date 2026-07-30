import { Droppable } from "@hello-pangea/dnd";
import type { Identifier } from "ra-core";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import type { PipelineState, ShidduchSummary } from "../types";
import {
  INITIAL_PIPELINE_STATES,
  isValidTransition,
  PIPELINE_GROUPS,
  type PipelineStateDef,
} from "./pipelineStates";
import { ShidduchCard } from "./ShidduchCard";

const PlusIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ShidduchColumn = ({
  state,
  shidduchim,
  tourAnchor = false,
  dragFrom = null,
  singleId,
}: {
  state: PipelineStateDef;
  shidduchim: ShidduchSummary[];
  /** Anchors `data-tour="pipeline-column"` for the walkthrough (first column only). */
  tourAnchor?: boolean;
  /**
   * AC-10: the state a card is currently being dragged FROM, or null when no
   * drag is in progress. A column failing `isValidTransition(dragFrom,
   * state.value)` is not a droppable and dims — a column can never do the
   * wrong thing structurally, not just get a post-hoc warning toast.
   */
  dragFrom?: PipelineState | null;
  /**
   * Story 5.1 AC 3: the single currently selected by the pipeline's own
   * pill row, threaded onto the "Add here" link so the create page
   * (`ShidduchCreatePage`) lands on the same single the column is already
   * showing, instead of always falling back to the account's first single.
   */
  singleId?: Identifier;
}) => {
  const canAdd = INITIAL_PIPELINE_STATES.includes(state.value);
  const groupLabel =
    PIPELINE_GROUPS.find((g) => g.id === state.group)?.label ?? "";
  const isDropDisabled =
    dragFrom !== null && !isValidTransition(dragFrom, state.value);

  return (
    <section
      data-tour={tourAnchor ? "pipeline-column" : undefined}
      className={cn(
        "flex w-[250px] shrink-0 flex-col gap-3 transition-opacity duration-150",
        isDropDisabled && "opacity-40",
      )}
    >
      <div className="h-[15px] px-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        {groupLabel}
      </div>

      <div className="flex items-center gap-2 px-1">
        <span
          className="h-[9px] w-[9px] shrink-0 rounded-full"
          style={{
            backgroundColor: `var(${state.token})`,
            boxShadow: `0 0 0 3px color-mix(in oklch, var(${state.token}) 22%, transparent)`,
          }}
        />
        <span className="text-[13.5px] font-semibold">{state.label}</span>
        <span className="ms-auto min-w-[22px] rounded-full bg-secondary px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {shidduchim.length}
        </span>
      </div>

      <div
        className="mx-1 -mt-1.5 h-0.5 rounded"
        style={{
          backgroundColor: `color-mix(in oklch, var(${state.token}) 55%, transparent)`,
        }}
      />

      {state.note ? (
        <p className="-mt-1 px-1 text-[11px] leading-snug text-muted-foreground">
          {state.note}
        </p>
      ) : null}

      <Droppable droppableId={state.value} isDropDisabled={isDropDisabled}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex min-h-[48px] flex-col gap-2.5 rounded-2xl",
              snapshot.isDraggingOver ? "bg-muted" : "",
            )}
          >
            {shidduchim.map((shidduch, index) => (
              <ShidduchCard
                key={shidduch.id}
                shidduch={shidduch}
                index={index}
                tourAnchor={tourAnchor && index === 0}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {canAdd ? (
        <Link
          to={
            singleId != null
              ? `${buildNewPath("shidduchim")}?state=${state.value}&single_id=${singleId}`
              : `${buildNewPath("shidduchim")}?state=${state.value}`
          }
          // Task 8: the tour's "add-suggestion" step now anchors here (the
          // first/anchor column's own Add-here link) rather than the
          // desktop-only toolbar CreateButton — this exists on every width.
          data-tour={tourAnchor ? "add-suggestion" : undefined}
          className="flex items-center gap-1.5 rounded-xl border border-dashed px-2.5 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PlusIcon /> Add here
        </Link>
      ) : null}
    </section>
  );
};

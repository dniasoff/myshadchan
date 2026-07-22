import { Droppable } from "@hello-pangea/dnd";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import type { ShidduchSummary } from "../types";
import {
  INITIAL_PIPELINE_STATES,
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
}: {
  state: PipelineStateDef;
  shidduchim: ShidduchSummary[];
}) => {
  const canAdd = INITIAL_PIPELINE_STATES.includes(state.value);
  const groupLabel =
    PIPELINE_GROUPS.find((g) => g.id === state.group)?.label ?? "";

  return (
    <section className="flex w-[250px] shrink-0 flex-col gap-3">
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
        <span className="flex items-baseline gap-1.5 text-[13.5px] font-semibold">
          <span>{state.label}</span>
          <span
            className="font-hebrew text-[12.5px] font-medium text-muted-foreground"
            dir="rtl"
          >
            {state.labelHe}
          </span>
        </span>
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

      <Droppable droppableId={state.value}>
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
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {canAdd ? (
        <Link
          to={`/shidduchim/create?state=${state.value}`}
          className="flex items-center gap-1.5 rounded-xl border border-dashed px-2.5 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PlusIcon /> Add here
        </Link>
      ) : null}
    </section>
  );
};

import { useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh } from "ra-core";

import { cn } from "@/lib/utils";

import { StateChip } from "../misc/StateChip";
import type { CrmDataProvider } from "../providers/types";
import type { PipelineState } from "../types";
import {
  getPipelineStateDef,
  isValidTransition,
  PIPELINE_STATES,
} from "./pipelineStates";

const DECISION_STATES: PipelineState[] = ["yes", "unsure", "no"];

/**
 * The state-transition control (Screen 18 body). Renders all 7 states as
 * StateChips; only the ones the transition graph actually allows from the
 * current state are clickable — the same isValidTransition() guard the board
 * drag-and-drop uses (AD-4 invariant 2). The DB's transition_shidduch() RPC
 * remains the enforcing authority; this is the friendly client mirror.
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
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [pendingTo, setPendingTo] = useState<PipelineState | null>(null);

  const handleMove = async (to: PipelineState) => {
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
      await dataProvider.transitionShidduch(id, currentState, to);
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

  return (
    <section
      data-tour="state-control"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <h3 className="mb-3 font-display text-lg font-semibold">
        Move through the pipeline
      </h3>
      <div className="flex flex-wrap gap-2">
        {PIPELINE_STATES.map((def) => {
          const isCurrent = def.value === currentState;
          const clickable =
            !isCurrent && isValidTransition(currentState, def.value);
          const tokenVar = `var(${def.token})`;

          return (
            <button
              key={def.value}
              type="button"
              disabled={pendingTo !== null || (!isCurrent && !clickable)}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => handleMove(def.value)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-0.5 outline-none",
                "transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                clickable &&
                  "cursor-pointer hover:-translate-y-0.5 active:scale-[0.97]",
                !clickable && !isCurrent && "opacity-40",
                isCurrent && "cursor-default",
                pendingTo === def.value && "animate-pulse",
              )}
              style={
                isCurrent
                  ? {
                      boxShadow: `0 0 0 2px color-mix(in oklch, ${tokenVar} 55%, transparent), 0 0 18px -4px color-mix(in oklch, ${tokenVar} 65%, transparent)`,
                    }
                  : undefined
              }
            >
              <StateChip state={def.value} />
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A decision (Yes / Unsure / No) can only be made from Look-into.
      </p>
    </section>
  );
};

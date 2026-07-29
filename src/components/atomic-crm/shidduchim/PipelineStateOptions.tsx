import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PipelineState } from "../types";
import { getPipelineStateDef, PIPELINE_GROUPS } from "./pipelineStates";
import type { PipelineStateOption } from "./useShidduchTransition";

export interface PipelineStateOptionsProps {
  options: PipelineStateOption[];
  pendingTo: PipelineState | null;
  onSelect: (option: PipelineStateOption) => void;
}

/**
 * AC-8's vertical, group-labelled option list — consumed by both
 * `ShidduchMoveSheet` (mobile bottom sheet) and the refactored
 * `ShidduchStateControl` (Screen 18 body), so the "every state reachable in
 * two taps" model has exactly one rendering, not two.
 *
 * Legality never hides a row: an illegal, non-current row stays in the
 * document with `aria-disabled="true"` — never the native `disabled`
 * attribute, which would drop it from the accessibility tree — so it is
 * still focusable and still fires `onSelect` (the caller's `move()` then
 * raises the existing warning `notify()`, per `classifySelection`).
 */
export const PipelineStateOptions = ({
  options,
  pendingTo,
  onSelect,
}: PipelineStateOptionsProps) => (
  <div className="flex flex-col gap-4">
    {PIPELINE_GROUPS.map((group) => {
      const groupOptions = options.filter(
        (option) => option.group === group.id,
      );
      if (groupOptions.length === 0) return null;

      return (
        <div key={group.id} className="flex flex-col gap-1">
          <div className="px-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </div>
          <div className="flex flex-col gap-1">
            {groupOptions.map((option) => (
              <PipelineStateOptionRow
                key={option.state}
                option={option}
                pending={pendingTo === option.state}
                onSelect={() => onSelect(option)}
              />
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

const PipelineStateOptionRow = ({
  option,
  pending,
  onSelect,
}: {
  option: PipelineStateOption;
  pending: boolean;
  onSelect: () => void;
}) => {
  const def = getPipelineStateDef(option.state);
  const isIllegal = !option.isCurrent && !option.isAllowed;
  // An explicit accessible name, rather than letting it fall back to the
  // concatenated text content: two adjacent block-level `<span>`s (the label
  // and the reason/"Current stage" line) can compute with no whitespace
  // between them, which silently breaks a naive `/^No\b/`-style prefix match
  // the moment one label is itself a prefix of another's reason text (e.g.
  // "No" inside "Not reachable…"). An explicit, space-separated aria-label
  // keeps the name unambiguous regardless of DOM whitespace collapsing.
  const ariaLabel = [
    `${option.label}${option.isTerminal ? " · final" : ""}`,
    option.isCurrent ? "current stage" : option.reason,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      // AC-8: aria-disabled, never the native `disabled` attribute — an
      // illegal row must stay focusable and stay in the accessibility tree.
      aria-disabled={isIllegal ? "true" : undefined}
      aria-current={option.isCurrent ? "step" : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-start outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        option.isCurrent && "cursor-default bg-secondary",
        !option.isCurrent &&
          option.isAllowed &&
          "cursor-pointer hover:bg-secondary/70",
        isIllegal && "cursor-pointer opacity-50",
        pending && "animate-pulse",
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(${def?.token})` }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {option.label}
          {/* Terminal destinations are marked "· final" BEFORE the tap (AC-8). */}
          {option.isTerminal ? " · final" : ""}
        </span>
        {option.isCurrent ? (
          <span className="block text-xs text-muted-foreground">
            Current stage
          </span>
        ) : option.reason ? (
          <span className="block text-xs text-muted-foreground">
            {option.reason}
          </span>
        ) : null}
      </span>
      {option.isCurrent ? (
        <Check
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
};

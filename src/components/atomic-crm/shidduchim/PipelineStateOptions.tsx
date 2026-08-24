import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PipelineState } from "../types";
import { getPipelineStateDef, PIPELINE_GROUPS } from "./pipelineStates";
import type { PipelineStateOption } from "./useShidduchTransition";

/**
 * `"list"` stacks every state vertically, one full-width row each — right for
 * a bottom sheet, where vertical is the only axis there is.
 *
 * `"row"` lays the same states out as chips, groups side by side. On the
 * Shidduch 360 page the list form cost ~750px before the tabs, pushing the
 * facts, the resume and the single's input below the fold on a laptop — so a
 * control you touch a handful of times per suggestion outranked everything
 * you actually read. Same options, same order, same legality, ~100px.
 */
export type PipelineStateOptionsOrientation = "list" | "row";

export interface PipelineStateOptionsProps {
  options: PipelineStateOption[];
  pendingTo: PipelineState | null;
  onSelect: (option: PipelineStateOption) => void;
  /** Defaults to `"list"` — the mobile sheet's shape, unchanged. */
  orientation?: PipelineStateOptionsOrientation;
}

/**
 * AC-8's group-labelled option list — consumed by both `ShidduchMoveSheet`
 * (mobile bottom sheet) and `ShidduchStateControl` (Screen 18 body), so the
 * "every state reachable in two taps" model has exactly one rendering, not
 * two. `orientation` changes the LAYOUT only: both forms render every state,
 * in pipeline order, with identical legality, identical accessible names and
 * the same `onSelect`.
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
  orientation = "list",
}: PipelineStateOptionsProps) => {
  const isRow = orientation === "row";

  return (
    <div
      className={cn(
        isRow
          ? "flex flex-wrap items-start gap-x-8 gap-y-4"
          : "flex flex-col gap-4",
      )}
    >
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
            <div className={cn("flex gap-1", isRow ? "flex-wrap" : "flex-col")}>
              {groupOptions.map((option) => (
                <PipelineStateOptionRow
                  key={option.state}
                  option={option}
                  pending={pendingTo === option.state}
                  isRow={isRow}
                  onSelect={() => onSelect(option)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const PipelineStateOptionRow = ({
  option,
  pending,
  isRow,
  onSelect,
}: {
  option: PipelineStateOption;
  pending: boolean;
  isRow: boolean;
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
      // In row form the secondary line is dropped for height, so the reason
      // an illegal destination is illegal ("Only reachable from Look-into.")
      // must still be reachable by pointer — it is already in `aria-label`
      // for assistive tech either way.
      title={isRow ? (ariaLabel ?? undefined) : undefined}
      // AC-8: aria-disabled, never the native `disabled` attribute — an
      // illegal row must stay focusable and stay in the accessibility tree.
      aria-disabled={isIllegal ? "true" : undefined}
      aria-current={option.isCurrent ? "step" : undefined}
      onClick={onSelect}
      className={cn(
        "flex items-center text-start outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isRow
          ? "min-h-9 gap-2 rounded-full border border-border px-3 py-1.5"
          : "min-h-11 gap-2.5 rounded-xl px-3 py-2",
        option.isCurrent && "cursor-default bg-secondary",
        option.isCurrent && isRow && "border-transparent",
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
      <span className={cn("min-w-0", !isRow && "flex-1")}>
        <span className="block whitespace-nowrap text-sm font-semibold">
          {option.label}
          {/* Terminal destinations are marked "· final" BEFORE the tap (AC-8). */}
          {option.isTerminal ? " · final" : ""}
        </span>
        {/* The secondary line is what makes the list form tall, so the row
            form drops it. Nothing is lost that a reader needs: "Current
            stage" is already carried by the check mark and `aria-current`,
            and the reason moves to `title` + `aria-label` above. */}
        {isRow ? null : option.isCurrent ? (
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

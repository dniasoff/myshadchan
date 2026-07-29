import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { ShidduchSummary } from "../types";
import { formatRedtDate } from "./boardUtils";

export interface ShidduchRowProps {
  shidduch: ShidduchSummary;
  onMove: () => void;
  /** "row" (List position, default) or "card" (Cards position) — identical
   * content either way (Task 4), only the outer container chrome differs. */
  layout?: "row" | "card";
  /** Anchors `data-tour="pipeline-card"` for the walkthrough (first row of
   * the first section only) — Task 8's List/Cards counterpart to
   * `ShidduchCard`'s own `tourAnchor` prop on the Board. */
  tourAnchor?: boolean;
}

/**
 * The pipeline list row (Task 4): 40px monogram · name · a second line of
 * facts, tail facts dropped before the redt date · an optional catch chip ·
 * a trailing Move button. Deliberately does NOT reuse `ShidduchCard`
 * (wrapped in `@hello-pangea/dnd`'s `<Draggable>`, requiring board-only
 * ancestors) — only its bare helpers (`getMonogram`/`getAvatarIndex`,
 * `formatRedtDate`). No state chip: the enclosing `PipelineSection` IS the
 * state (AC-7).
 *
 * AC-12: the record mention is a `RecordLink` (exactly its five closed
 * props) and the Move button is a SIBLING of the anchor — never a prop on
 * it, never nested inside it.
 */
export const ShidduchRow = ({
  shidduch,
  onMove,
  layout = "row",
  tourAnchor = false,
}: ShidduchRowProps) => {
  const name = shidduch.name_en ?? shidduch.single_first_name_en ?? "Unnamed";
  const monogram = getMonogram(shidduch.name_en);
  const avatarIndex = getAvatarIndex(shidduch.name_en ?? String(shidduch.id));
  const redt = formatRedtDate(shidduch.redt_date);
  const lineTwo = [
    shidduch.location_en,
    shidduch.seminary_en,
    redt ? `Redt ${redt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const catchCount = shidduch.catch_count ?? 0;

  return (
    <div
      data-slot="pipeline-row"
      data-tour={tourAnchor ? "pipeline-card" : undefined}
      className={cn(
        "flex items-center gap-3",
        layout === "card"
          ? "rounded-2xl border bg-card p-3.5 shadow-sm"
          : "px-1 py-2.5",
      )}
    >
      <RecordLink
        resource="shidduchim"
        id={shidduch.id}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
        >
          {monogram}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">
            {name}
          </span>
          {lineTwo ? (
            <span className="block truncate text-xs text-muted-foreground">
              {lineTwo}
            </span>
          ) : null}
          {catchCount > 0 ? (
            <span
              className="mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium
                text-attention-foreground
                bg-[color-mix(in_oklch,var(--attention)_18%,transparent)]"
            >
              Suggested before
            </span>
          ) : null}
        </span>
      </RecordLink>
      {/* AC-12: a sibling of the anchor above, never inside it. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 shrink-0"
        onClick={onMove}
      >
        ⇄ Move
      </Button>
    </div>
  );
};

/** AC-13: the same shape as a loaded `ShidduchRow`, so a list of skeleton
 * rows has the exact height a list of loaded rows would. */
export const ShidduchRowSkeleton = () => (
  <div data-slot="pipeline-row" className="flex items-center gap-3 px-1 py-2.5">
    <span
      aria-hidden="true"
      className="size-10 shrink-0 animate-pulse rounded-[11px] bg-muted"
    />
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="h-3.5 w-32 animate-pulse rounded bg-muted" />
      <span className="h-3 w-48 animate-pulse rounded bg-muted" />
    </span>
    <span className="h-9 w-20 shrink-0 animate-pulse rounded-lg bg-muted" />
  </div>
);

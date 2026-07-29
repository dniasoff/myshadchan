import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { Single } from "../types";

export interface SingleRowProps {
  single: Single;
  index: number;
  /** Same optional pipeline count as `SingleCard` (E6) — undefined or 0
   * hides the "N in pipeline" chip. */
  openCount?: number;
}

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

/**
 * The List-mode counterpart to `SingleCard` (Story 4.2, Task 4 / AC 1): the
 * same identity/meta/status/pipeline-count data as the card, laid out as one
 * compact row instead. `single`/`openCount` are always caller-supplied —
 * this component never fetches (`SingleCardGrid`'s enrichment read stays the
 * only `singles_summary` query on this page).
 */
export const SingleRow = ({ single, index, openCount }: SingleRowProps) => {
  const nameEn = [single.first_name_en, single.last_name_en]
    .filter(Boolean)
    .join(" ");
  const displayName = nameEn || `Single #${single.id}`;
  const monogramSeed = nameEn || undefined;
  const monogram = getMonogram(monogramSeed);
  const avatarIndex = getAvatarIndex(monogramSeed ?? String(single.id));
  const meta = [GENDER_LABEL[single.gender ?? ""], single.community]
    .filter(Boolean)
    .join(" · ");
  const isActive = single.status === "active";
  const statusLabel = STATUS_LABEL[single.status] ?? single.status;
  const showOpenCount = typeof openCount === "number" && openCount > 0;

  return (
    <RecordLink
      resource="singles"
      id={single.id}
      className="ql-enter block cursor-pointer rounded-xl outline-none
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="flex-row items-center gap-3.5 rounded-xl p-3.5 shadow-sm
          transition-all duration-[160ms] ease-[var(--ease-out)]
          hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
      >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
          aria-hidden="true"
        >
          {monogram}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm font-semibold leading-tight">
            {nameEn || displayName}
          </div>
          {meta ? (
            <p className="truncate text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5",
            "text-xs font-semibold",
            !isActive && "bg-secondary text-muted-foreground",
          )}
          style={
            isActive
              ? {
                  color:
                    "color-mix(in oklch, var(--positive) var(--chip-text-mix), black)",
                  backgroundColor:
                    "color-mix(in oklch, var(--positive) 16%, transparent)",
                  boxShadow:
                    "inset 0 0 0 1px color-mix(in oklch, var(--positive) 28%, transparent)",
                }
              : undefined
          }
        >
          {isActive ? (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--positive)" }}
              aria-hidden="true"
            />
          ) : null}
          {statusLabel}
        </span>
        {showOpenCount ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {openCount} in pipeline
          </span>
        ) : null}
      </Card>
    </RecordLink>
  );
};

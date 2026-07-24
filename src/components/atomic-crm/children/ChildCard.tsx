import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import type { Child } from "../types";

export interface ChildCardProps {
  child: Child;
  index: number;
  /**
   * Still-in-triage suggestion count from children_summary (E6). Optional so the
   * card renders fine when the count is unavailable (e.g. older demo data);
   * undefined or 0 simply hides the "N in pipeline" line.
   */
  openCount?: number;
}

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
};

/**
 * One child's card in the roster grid (design-language §5.1 card recipe):
 * monogram avatar, name, gender/community meta, and a status pill
 * (design-language §5.5 tinted-pill formula applied to `--positive` instead
 * of a pipeline-state token). Pressing the card opens the child's profile
 * (`ChildShow`).
 */
export const ChildCard = ({ child, index, openCount }: ChildCardProps) => {
  const nameEn = [child.first_name_en, child.last_name_en]
    .filter(Boolean)
    .join(" ");
  const displayName = nameEn || `Child #${child.id}`;
  const monogramSeed = nameEn || undefined;
  const monogram = getMonogram(monogramSeed);
  const avatarIndex = getAvatarIndex(monogramSeed ?? String(child.id));
  const meta = [GENDER_LABEL[child.gender ?? ""], child.community]
    .filter(Boolean)
    .join(" · ");
  const isActive = child.status === "active";
  // "N in pipeline" — the still-in-triage suggestions for this child (E6). Only
  // shown when a positive count is supplied; a missing count (summary
  // unavailable, older demo data) renders nothing rather than a bare zero.
  const showOpenCount = typeof openCount === "number" && openCount > 0;

  return (
    <Link
      to={`/children/${child.id}/show`}
      className="ql-enter block cursor-pointer rounded-xl outline-none
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="gap-0 p-5 shadow-sm transition-all duration-[160ms]
          ease-[--ease-out] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
      >
        <div className="flex items-start gap-3.5">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-base font-bold"
            style={{
              backgroundColor: `var(--avatar-${avatarIndex})`,
              color: "var(--avatar-ink)",
            }}
            aria-hidden="true"
          >
            {monogram}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-semibold leading-tight">
              {nameEn || displayName}
            </div>
            {meta ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{meta}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
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
            {isActive ? "Active" : "Paused"}
          </span>
          {showOpenCount ? (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {openCount} in pipeline
            </span>
          ) : null}
        </div>
      </Card>
    </Link>
  );
};

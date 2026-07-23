import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import type { Child } from "../types";

export interface ChildCardProps {
  child: Child;
  index: number;
}

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
};

/**
 * One child's card in the roster grid (design-language §5.1 card recipe):
 * monogram avatar, bilingual name — Hebrew on its own line, never jammed
 * against the English with a margin-start, per the RTL rule — gender/
 * community meta, and a status pill (design-language §5.5 tinted-pill
 * formula applied to `--positive` instead of a pipeline-state token).
 * Pressing the card opens the child's profile (`ChildShow`).
 */
export const ChildCard = ({ child, index }: ChildCardProps) => {
  const nameEn = [child.first_name_en, child.last_name_en]
    .filter(Boolean)
    .join(" ");
  const nameHe = [child.first_name_he, child.last_name_he]
    .filter(Boolean)
    .join(" ");
  const displayName = nameEn || nameHe || `Child #${child.id}`;
  const monogramSeed = nameEn || child.first_name_he || undefined;
  const monogram = getMonogram(monogramSeed);
  const avatarIndex = getAvatarIndex(monogramSeed ?? String(child.id));
  const meta = [GENDER_LABEL[child.gender ?? ""], child.community]
    .filter(Boolean)
    .join(" · ");
  const isActive = child.status === "active";

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
              {nameEn ? (
                nameEn
              ) : nameHe ? (
                <span className="font-hebrew" dir="rtl">
                  {nameHe}
                </span>
              ) : (
                displayName
              )}
              {nameEn && nameHe ? (
                <span
                  className="font-hebrew mt-0.5 block text-sm font-medium text-muted-foreground"
                  dir="rtl"
                >
                  {nameHe}
                </span>
              ) : null}
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
        </div>
      </Card>
    </Link>
  );
};

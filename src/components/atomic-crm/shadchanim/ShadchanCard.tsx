import { MapPin, Send } from "lucide-react";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import type { Shadchan } from "../types";
import { ResponsivenessChip } from "./ResponsivenessChip";

export interface ShadchanCardProps {
  shadchan: Shadchan;
  suggestionCount: number;
  /** Position in the grid, drives the `.ql-enter` stagger delay. */
  index: number;
}

/**
 * One row of the shadchan book: monogram + bilingual name (mirrors
 * `ShidduchCard`'s identity pattern), location, a tasteful responsiveness
 * cue, and the count of suggestions this shadchan has redt.
 */
export const ShadchanCard = ({
  shadchan,
  suggestionCount,
  index,
}: ShadchanCardProps) => {
  const monogram = getMonogram(shadchan.name);
  const avatarIndex = getAvatarIndex(shadchan.name ?? String(shadchan.id));

  return (
    <Link
      to={`/shadchanim/${shadchan.id}/show`}
      className="ql-enter block rounded-2xl outline-none transition-transform
        duration-[160ms] ease-[--ease-spring] active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="gap-0 p-4 shadow-sm transition-[box-shadow,transform] duration-[160ms]
          ease-[--ease-out] hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
            style={{
              backgroundColor: `var(--avatar-${avatarIndex})`,
              color: "var(--avatar-ink)",
            }}
          >
            {monogram}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">
              {shadchan.name}
              {shadchan.name_he ? (
                <span
                  className="font-hebrew mt-px block text-[13px] font-medium text-muted-foreground"
                  dir="rtl"
                >
                  {shadchan.name_he}
                </span>
              ) : null}
            </div>
            {shadchan.location ? (
              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{shadchan.location}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <ResponsivenessChip value={shadchan.responsiveness} />
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
            <Send className="size-3 shrink-0" aria-hidden="true" />
            {suggestionCount} {suggestionCount === 1 ? "suggestion" : "suggestions"}
          </span>
        </div>
      </Card>
    </Link>
  );
};

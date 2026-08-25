import { MapPin, Send } from "lucide-react";
import { useTranslate } from "ra-core";

import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { Shadchan } from "../types";
import { ResponsivenessChip } from "./ResponsivenessChip";

export interface ShadchanCardProps {
  shadchan: Shadchan;
  suggestionCount: number;
  /** Position in the grid, drives the `.ql-enter` stagger delay. */
  index: number;
}

/**
 * One row of the shadchan book: monogram + name (mirrors `ShidduchCard`'s
 * identity pattern), location, a tasteful responsiveness cue, and the count
 * of shidduchim this shadchan has redt.
 *
 * Story 5.9 (AD-23 remediation): the rendered count label now reads
 * "shidduch"/"shidduchim", never "suggestion(s)" — the one live AD-23
 * violation this story owns (`ShadchanRow.tsx`'s Story 4.2 doc comment named
 * it as this story's job). `suggestionCount` and `countSuggestionsByShadchan`
 * keep their existing DB/code names, per that same doc comment — only the
 * rendered label changes, via the same i18n key `ShadchanRow.tsx` already
 * uses.
 */
export const ShadchanCard = ({
  shadchan,
  suggestionCount,
  index,
}: ShadchanCardProps) => {
  const translate = useTranslate();
  const countLabel = translate("crm.shadchanim.row.shidduchimCount", {
    smart_count: suggestionCount,
    _: "%{smart_count} shidduch |||| %{smart_count} shidduchim",
  });
  const monogram = getMonogram(shadchan.name);
  const avatarIndex = getAvatarIndex(shadchan.name ?? String(shadchan.id));

  return (
    <RecordLink
      resource="shadchanim"
      id={shadchan.id}
      className="ql-enter block rounded-2xl outline-none transition-transform
        duration-[160ms] ease-[var(--ease-spring)] active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="gap-0 p-4 shadow-sm transition-[box-shadow,transform] duration-[160ms]
          ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex items-start gap-3">
          {/* aria-hidden: the monogram is a decorative restatement of the
              name rendered right beside it, so a screen reader otherwise
              announces "RS" before "Rivka Stern". Every sibling in this
              surface group already hides it (ShadchanRow, SingleCard,
              SingleRow, ConnectionCard) — this card was the outlier. */}
          <div
            aria-hidden="true"
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
          <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
            <Send className="size-3 shrink-0" aria-hidden="true" />
            {countLabel}
          </span>
        </div>
      </Card>
    </RecordLink>
  );
};

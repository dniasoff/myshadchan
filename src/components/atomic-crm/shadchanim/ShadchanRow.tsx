import { MapPin, Send } from "lucide-react";
import { useTranslate } from "ra-core";

import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { Shadchan } from "../types";
import {
  getShadchanPhoneMatch,
  getShadchanPhoneMatchLabel,
} from "./shadchanUtils";
import { ShadchanNoteAction } from "./ShadchanNoteAction";
import type { ShadchanNote } from "./useShadchanNotes";

export interface ShadchanRowProps {
  shadchan: Shadchan;
  suggestionCount: number;
  phoneSearchQuery?: string;
  /** Position in the list, drives the `.ql-enter` stagger delay. */
  index: number;
  note?: ShadchanNote;
}

/**
 * The List-mode counterpart to `ShadchanCard` (Story 4.2, Task 4 / AC 1):
 * the same identity/location/count data, laid out as one compact row.
 *
 * AC 5 (AD-23 vocabulary): the count reads "shidduch"/"shidduchim", never
 * "suggestion(s)" — `suggestionCount` and `countSuggestionsByShadchan` keep
 * their DB/code names (unchanged by this story). Story 5.9 later pointed
 * `ShadchanCard.tsx`'s own count label at this same i18n key, retiring the
 * text this component's own label already avoided.
 *
 * Also avoids `ShadchanCard.tsx`'s known horizontal-overflow defect
 * (`whitespace-nowrap` on its count text, measured `scrollWidth 799` in a
 * 768px viewport — see this story's Dev Notes): the name/location column is
 * `min-w-0 truncate` and the count chip is `shrink-0`, so a long name never
 * pushes the row wider than its container.
 */
export const ShadchanRow = ({
  shadchan,
  suggestionCount,
  index,
  phoneSearchQuery,
  note,
}: ShadchanRowProps) => {
  const translate = useTranslate();
  const monogram = getMonogram(shadchan.name);
  const avatarIndex = getAvatarIndex(shadchan.name ?? String(shadchan.id));
  const countLabel = translate("crm.shadchanim.row.shidduchimCount", {
    smart_count: suggestionCount,
    _: "%{smart_count} shidduch |||| %{smart_count} shidduchim",
  });
  const phoneMatch = phoneSearchQuery
    ? getShadchanPhoneMatch(shadchan, phoneSearchQuery)
    : null;

  return (
    <Card
      className="ql-enter flex-row items-center gap-3 rounded-xl p-3 shadow-sm
        transition-[box-shadow,transform] duration-[160ms]
        ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <RecordLink
        resource="shadchanim"
        id={shadchan.id}
        aria-label={`Open ${shadchan.name} file`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none
          transition-transform duration-[160ms] ease-[var(--ease-spring)]
          active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring
          focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
          aria-hidden="true"
        >
          {monogram}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">
            {shadchan.name}
          </div>
          {shadchan.location ? (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{shadchan.location}</span>
            </div>
          ) : null}
        </div>
        {phoneMatch ? (
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {getShadchanPhoneMatchLabel(phoneMatch)}
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
          <Send className="size-3 shrink-0" aria-hidden="true" />
          {countLabel}
        </span>
        <span className="shrink-0 text-[11.5px] font-medium text-muted-foreground">
          Open file
        </span>
      </RecordLink>
      {note ? <ShadchanNoteAction shadchan={shadchan} note={note} /> : null}
    </Card>
  );
};

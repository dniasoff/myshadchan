import { format } from "date-fns";

import { EntityAvatar } from "../entity360/EntityAvatar";
import { StateChip } from "../misc/StateChip";
import type { ShidduchSummary } from "../types";
import { ClockIcon } from "./ClockIcon";
import { formatRedtDate } from "./boardUtils";

/** Format an ISO timestamp (e.g. first_suggested_at) as "9 Jul 2026". */
const formatSuggestedAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format(date, "d MMM yyyy");
};

/**
 * The 360 view header (Screen 18): monogram avatar, bilingual name, current
 * state, and the "via {shadchan} · Redt {date} · redt xN" meta row — the
 * board card's identity treatment, raised to hero scale. Renders as
 * `identityHeader` on a real page (Story 5.1) — no `DialogTitle` wrapper;
 * this component was the routed dialog's own title until then.
 */
export const ShidduchShowHeader = ({
  shidduch,
  firstSuggestedByName,
}: {
  shidduch: ShidduchSummary;
  /** Resolved name of shidduch.first_suggested_by (looked up by the parent
   * against the shadchanim list it already fetches for the redt history). */
  firstSuggestedByName?: string | null;
}) => {
  const name = shidduch.name_en ?? shidduch.single_first_name_en ?? "Shidduch";
  const meta = [shidduch.location_en, shidduch.seminary_en]
    .filter(Boolean)
    .join(" · ");
  const nbRedts = shidduch.nb_redts ?? 0;
  const hasFirstSuggested =
    Boolean(firstSuggestedByName) || Boolean(shidduch.first_suggested_at);

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <EntityAvatar
          seed={shidduch.name_en ?? String(shidduch.id)}
          monogramSource={shidduch.name_en}
          className="size-14 rounded-2xl text-lg"
        />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-bold tracking-tight">
            <span>{name}</span>
            {shidduch.name_he ? (
              <span
                className="font-hebrew text-lg font-medium text-muted-foreground"
                dir="rtl"
              >
                {shidduch.name_he}
              </span>
            ) : null}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StateChip state={shidduch.pipeline_state} />
            {meta ? (
              <span className="text-sm text-muted-foreground">{meta}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
        {shidduch.shadchan_name ? (
          <>
            <span>via {shidduch.shadchan_name}</span>
            <span className="size-[3px] rounded-full bg-muted-foreground/50" />
          </>
        ) : null}
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ClockIcon />
          Redt {formatRedtDate(shidduch.redt_date)}
        </span>
        {nbRedts > 1 ? (
          <>
            <span className="size-[3px] rounded-full bg-muted-foreground/50" />
            <span
              className="tabular-nums font-medium"
              title={`Redt ${nbRedts} times`}
            >
              redt ×{nbRedts}
            </span>
          </>
        ) : null}
      </div>

      {hasFirstSuggested ? (
        <p className="text-xs text-muted-foreground">
          First suggested
          {firstSuggestedByName ? ` by ${firstSuggestedByName}` : ""}
          {shidduch.first_suggested_at
            ? ` · ${formatSuggestedAt(shidduch.first_suggested_at)}`
            : ""}
        </p>
      ) : null}
    </header>
  );
};

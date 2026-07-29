import { useState } from "react";
import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";

import { Card } from "@/components/ui/card";

import { RecordLink } from "../entity360/RecordLink";
import { StateChip } from "../misc/StateChip";
import { formatRedtDate } from "../shidduchim/boardUtils";
import type { ShidduchSummary } from "../types";

export interface ShadchanSuggestionsProps {
  shadchanId: Identifier;
}

const PREVIEW_LIMIT = 5;

// `md:` (768px), not `sm:` (640px) — matches the app's one real mobile-shell
// breakpoint (`useIsMobile`'s `MOBILE_BREAKPOINT`, and the `min-h-11 md:min-h-9`
// floor on `ui/button.tsx` / `ui/tabs.tsx`). At `sm:` this row dropped its
// 44px touch target a whole 128px early, in the 640-767px band where the app
// still renders its mobile shell and bottom nav (wave S review, F4).
const ROW_CLASS_NAME =
  "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1 outline-none transition-colors " +
  "hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background " +
  "md:grid md:min-h-9 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_10rem_auto] md:gap-4";

const TOGGLE_CLASS_NAME =
  "mt-2 flex min-h-11 w-full items-center rounded-lg px-2 text-left text-xs font-semibold " +
  "text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background md:min-h-9";

/**
 * "Shidduchim from this shadchan" (screen 20, mobile-redesign-plan.md §4
 * S-D) — every shidduch this matchmaker has redt, across every single,
 * newest first. Real productivity stats live in `ShadchanStatsRow` above;
 * this list is the informative, non-judgmental payload beneath it — no
 * numbers are fabricated. Collapses to a 5-row preview with an in-place
 * "Show all N" toggle rather than a static "+N more" label (wave S review,
 * F2) — every shidduch stays reachable from this screen without a route:
 * there is still no shadchan-filtered shidduchim list to link a "view all"
 * row to (that list is single-scoped today, `shidduchim/ShidduchimList.tsx`,
 * out of this wave's declared files).
 */
export const ShadchanSuggestions = ({
  shadchanId,
}: ShadchanSuggestionsProps) => {
  const [showAll, setShowAll] = useState(false);
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    filter: { shadchan_id: shadchanId },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "redt_date", order: "DESC" },
  });

  const items = data ?? [];
  const hasMore = items.length > PREVIEW_LIMIT;
  const visible = showAll ? items : items.slice(0, PREVIEW_LIMIT);

  return (
    <Card className="gap-0 p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Shidduchim from this shadchan
        </h2>
        <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      {isPending ? (
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-11 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No shidduchim from this shadchan yet.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col">
            {visible.map((item, index) => (
              <li
                key={item.id}
                className="ql-enter odd:bg-muted/50"
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              >
                <RecordLink
                  resource="shidduchim"
                  id={item.id}
                  className={ROW_CLASS_NAME}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-tight">
                      {item.name_en ?? "Unnamed"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                      {item.single_first_name_en
                        ? `for ${item.single_first_name_en}`
                        : null}
                      {item.single_first_name_en && item.redt_date
                        ? " · "
                        : null}
                      {item.redt_date
                        ? `Redt ${formatRedtDate(item.redt_date)}`
                        : null}
                    </div>
                  </div>
                  <div className="hidden truncate text-sm text-muted-foreground md:block">
                    {item.single_first_name_en
                      ? `for ${item.single_first_name_en}`
                      : null}
                  </div>
                  <div className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">
                    {item.redt_date
                      ? `Redt ${formatRedtDate(item.redt_date)}`
                      : null}
                  </div>
                  <StateChip state={item.pipeline_state} />
                </RecordLink>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className={TOGGLE_CLASS_NAME}
            >
              {showAll ? "Show less" : `Show all ${items.length}`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  );
};

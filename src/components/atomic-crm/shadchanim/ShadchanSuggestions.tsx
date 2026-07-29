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

const ROW_CLASS_NAME =
  "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1 outline-none transition-colors " +
  "hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "sm:grid sm:min-h-9 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_10rem_auto] sm:gap-4";

/**
 * "Shidduchim from this shadchan" (screen 20, mobile-redesign-plan.md §4
 * S-D) — every shidduch this matchmaker has redt, across every single,
 * newest first. Real productivity stats live in `ShadchanStatsRow` above;
 * this list is the informative, non-judgmental payload beneath it — no
 * numbers are fabricated. Capped to a 5-row preview so a prolific shadchan
 * (rich data) does not push the card past the page — there is no
 * shadchan-filtered shidduchim list route yet to link a "view all" row to
 * (that list is single-scoped today, `shidduchim/ShidduchimList.tsx`, out
 * of this wave's declared files), so the remainder renders as a plain count
 * rather than a link to nowhere useful.
 */
export const ShadchanSuggestions = ({
  shadchanId,
}: ShadchanSuggestionsProps) => {
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    filter: { shadchan_id: shadchanId },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "redt_date", order: "DESC" },
  });

  const items = data ?? [];
  const preview = items.slice(0, PREVIEW_LIMIT);
  const hiddenCount = items.length - preview.length;

  return (
    <Card className="p-4 shadow-sm">
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
            {preview.map((item, index) => (
              <li
                key={item.id}
                className="ql-enter odd:bg-muted/45"
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
                    <div className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
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
                  <div className="hidden truncate text-sm text-muted-foreground sm:block">
                    {item.single_first_name_en
                      ? `for ${item.single_first_name_en}`
                      : null}
                  </div>
                  <div className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                    {item.redt_date
                      ? `Redt ${formatRedtDate(item.redt_date)}`
                      : null}
                  </div>
                  <StateChip state={item.pipeline_state} />
                </RecordLink>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              +{hiddenCount} more
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
};

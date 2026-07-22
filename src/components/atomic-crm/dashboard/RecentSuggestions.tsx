import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import { StateChip } from "../misc/StateChip";
import { formatRedtDate } from "../shidduchim/boardUtils";
import type { ShidduchSummary } from "../types";

export interface RecentSuggestionsProps {
  childId: Identifier;
}

const RECENT_LIMIT = 5;

/** The most recently added shidduchim for a child, each a state-chipped card. */
export const RecentSuggestions = ({ childId }: RecentSuggestionsProps) => {
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    filter: { child_id: childId },
    pagination: { page: 1, perPage: RECENT_LIMIT },
    sort: { field: "created_at", order: "DESC" },
  });

  const items = data ?? [];

  return (
    <Card className="p-5 shadow-sm">
      <h2 className="mb-4 font-display text-lg font-semibold">
        Recent suggestions
      </h2>
      {isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No suggestions yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="ql-enter"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <Link
                to={`/shidduchim/${item.id}/show`}
                className="flex items-center justify-between gap-3 rounded-xl
                  border border-transparent p-3 outline-none
                  transition-colors duration-[160ms]
                  hover:border-border hover:bg-secondary
                  focus-visible:ring-2 focus-visible:ring-ring
                  focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 text-sm font-semibold leading-tight">
                    <span className="min-w-0 truncate">
                      {item.name_en ?? "Unnamed"}
                    </span>
                    {item.name_he ? (
                      <span
                        className="font-hebrew shrink-0 text-muted-foreground"
                        dir="rtl"
                      >
                        {item.name_he}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.shadchan_name ? `via ${item.shadchan_name}` : null}
                    {item.shadchan_name && item.redt_date ? " · " : null}
                    {item.redt_date
                      ? `Redt ${formatRedtDate(item.redt_date)}`
                      : null}
                  </div>
                </div>
                <StateChip state={item.pipeline_state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

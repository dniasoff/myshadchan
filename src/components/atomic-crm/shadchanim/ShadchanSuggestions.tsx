import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import { StateChip } from "../misc/StateChip";
import { formatRedtDate } from "../shidduchim/boardUtils";
import type { ShidduchSummary } from "../types";

export interface ShadchanSuggestionsProps {
  shadchanId: Identifier;
}

/**
 * "Suggestions from this shadchan" (screen 20) — every shidduch this
 * matchmaker has redt, across every child, newest first. Real productivity
 * stats (# progressed to Look-into/Decision, # led to dates) would need an
 * aggregate that does not exist yet — this list itself is the informative,
 * non-judgmental payload the ticket calls for; no numbers are fabricated.
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

  return (
    <Card className="p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">
        Suggestions from this shadchan
      </h2>
      {isPending ? (
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No suggestions from this shadchan yet.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
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
                    {item.child_first_name_en
                      ? `for ${item.child_first_name_en}`
                      : null}
                    {item.child_first_name_en && item.redt_date ? " · " : null}
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

import type { Identifier } from "ra-core";

import { cn } from "@/lib/utils";

import type { Single } from "../types";

export interface DashboardHeaderProps {
  singleList: Single[];
  singleId: Identifier;
  onSelectSingle: (id: Identifier) => void;
}

const singleLabel = (single: Single) =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `#${single.id}`;

/** Greeting + the prominent single switcher that drives the whole dashboard. */
export const DashboardHeader = ({
  singleList,
  singleId,
  onSelectSingle,
}: DashboardHeaderProps) => {
  const selected = singleList.find((single) => single.id === singleId);
  const nameEn = selected ? singleLabel(selected) : "";

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Welcome back
        </p>
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[2.5rem] sm:leading-[1.05]">
          {nameEn ? `${nameEn}'s shidduchim` : "Dashboard"}
        </h1>
      </div>

      {singleList.length > 1 ? (
        <div className="inline-flex gap-0.5 rounded-full border border-border bg-secondary p-0.5">
          {singleList.map((single) => (
            <button
              key={single.id}
              type="button"
              onClick={() => onSelectSingle(single.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-semibold outline-none",
                "transition-colors duration-[160ms]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                single.id === singleId
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {singleLabel(single)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

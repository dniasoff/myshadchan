import type { Identifier } from "ra-core";

import { cn } from "@/lib/utils";

import type { Child } from "../types";

export interface DashboardHeaderProps {
  childList: Child[];
  childId: Identifier;
  onSelectChild: (id: Identifier) => void;
}

const childLabel = (child: Child) =>
  [child.first_name_en, child.last_name_en].filter(Boolean).join(" ") ||
  child.first_name_he ||
  `#${child.id}`;

/** Greeting + the prominent child switcher that drives the whole dashboard. */
export const DashboardHeader = ({
  childList,
  childId,
  onSelectChild,
}: DashboardHeaderProps) => {
  const selected = childList.find((child) => child.id === childId);
  const nameEn = selected ? childLabel(selected) : "";
  const nameHe = selected?.first_name_he;

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Welcome back
        </p>
        <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[2.5rem] sm:leading-[1.05]">
          <span>{nameEn ? `${nameEn}'s shidduchim` : "Dashboard"}</span>
          {nameHe ? (
            <span
              className="font-hebrew text-xl font-medium text-muted-foreground sm:text-2xl"
              dir="rtl"
            >
              {nameHe}
            </span>
          ) : null}
        </h1>
      </div>

      {childList.length > 1 ? (
        <div className="inline-flex gap-0.5 rounded-full border border-border bg-secondary p-0.5">
          {childList.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onSelectChild(child.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-semibold outline-none",
                "transition-colors duration-[160ms]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                child.id === childId
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {childLabel(child)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

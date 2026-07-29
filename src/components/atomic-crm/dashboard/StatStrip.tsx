import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatStripItem {
  label: string;
  value: number;
  to?: string;
}

export interface StatStripProps {
  /** Renders in a fixed 3-column grid — the shape every current caller needs. */
  items: StatStripItem[];
  className?: string;
}

const SEGMENT_CLASS_NAME =
  "flex min-w-0 flex-col px-2 py-3 outline-none transition-colors duration-[160ms] sm:px-4";

const StatStripSegment = ({ label, value, to }: StatStripItem) => {
  const valueEl = (
    <span className="font-display text-2xl font-bold leading-[30px] tabular-nums tracking-[-0.02em]">
      {value}
    </span>
  );
  const labelEl = (
    <span className="mt-0.5 text-xs font-semibold uppercase leading-4 tracking-[0.06em] text-muted-foreground">
      {label}
    </span>
  );

  if (!to) {
    return (
      <span className={SEGMENT_CLASS_NAME}>
        {valueEl}
        {labelEl}
      </span>
    );
  }

  return (
    <Link
      to={to}
      className={cn(
        SEGMENT_CLASS_NAME,
        "hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {valueEl}
      {labelEl}
    </Link>
  );
};

/**
 * A dense row of value-over-label segments sharing one `Card` (mobile-
 * redesign-plan.md §4 S-A) — the replacement for stacking several
 * `DashboardStat` tiles when the tiles' own icon chip and per-tile card
 * chrome cost more height than the numbers are worth. A 2px gradient
 * hairline (the same `--accent-grad-from`/`--accent-grad-to` tokens as
 * `DashboardStat`'s icon chip) keeps the Quiet-Luminance accent at zero
 * height cost. Segments are optionally links, ring-inset so the focus ring
 * never escapes the shared card.
 */
export const StatStrip = ({ items, className }: StatStripProps) => (
  <Card className={cn("gap-0 overflow-hidden p-0 shadow-sm", className)}>
    <span
      aria-hidden="true"
      className="h-0.5 w-full shrink-0"
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--accent-grad-from), var(--accent-grad-to))",
      }}
    />
    <div className="grid grid-cols-3 divide-x divide-border">
      {items.map((item) => (
        <StatStripSegment key={item.label} {...item} />
      ))}
    </div>
  </Card>
);

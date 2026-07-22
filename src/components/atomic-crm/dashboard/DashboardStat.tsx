import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DashboardStatProps {
  label: string;
  value: number;
  icon: LucideIcon;
  to?: string;
  className?: string;
}

/**
 * A small reusable stat tile — accent-glow icon chip, label, big display
 * number, optional link (design-language §5.7: icon + glow, never a plain
 * number card).
 */
export const DashboardStat = ({
  label,
  value,
  icon: Icon,
  to,
  className,
}: DashboardStatProps) => {
  const card = (
    <Card
      className={cn(
        "gap-3 p-5 shadow-sm transition-[box-shadow,transform] duration-[160ms]",
        "ease-[--ease-out] hover:shadow-md hover:-translate-y-0.5",
        className,
      )}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))",
          boxShadow: "0 0 0 6px var(--glow-accent)",
        }}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </span>
        <span className="font-display text-4xl font-bold tabular-nums tracking-[-0.02em]">
          {value}
        </span>
      </span>
    </Card>
  );

  if (!to) return card;

  return (
    <Link
      to={to}
      className="block rounded-2xl outline-none focus-visible:ring-2
        focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
};

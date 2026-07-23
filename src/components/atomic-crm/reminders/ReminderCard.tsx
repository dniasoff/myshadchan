import { format } from "date-fns";
import { ClockIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { isOverdue } from "../tasks/tasksPredicate";
import type { ReminderItem } from "./useReminders";

export interface ReminderCardProps {
  item: ReminderItem;
  onComplete: () => void;
  onSnooze: () => void;
  /** Staggered entrance delay in ms (design-language §4.3). */
  enterDelayMs?: number;
}

/** "9 Jul 2026, 4:30 PM" — tabular, matches formatRedtDate's day precision plus time. */
const formatDueMoment = (dateString: string): string =>
  format(new Date(dateString), "d MMM, h:mm a");

/**
 * One reminder row. Overdue reads as the honey "catch" surface (design-
 * language §5.8) — never red, never alarming — with a calm "Since {date}"
 * instead of a raw overdue count. Quick-complete and snooze are both
 * one-tap, ≥44px targets.
 */
export const ReminderCard = ({
  item,
  onComplete,
  onSnooze,
  enterDelayMs = 0,
}: ReminderCardProps) => {
  const { task, linkedEntity } = item;
  const overdue = isOverdue(task.due_date);

  return (
    <li
      className="ql-enter"
      style={{ animationDelay: `${enterDelayMs}ms` }}
    >
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition-[box-shadow,transform] duration-[160ms] ease-[--ease-out] hover:shadow-md",
          overdue
            ? "border-[color-mix(in_oklch,var(--attention)_35%,transparent)] bg-[color-mix(in_oklch,var(--attention)_10%,transparent)]"
            : "border-border bg-card",
        )}
      >
        <Checkbox
          className="mt-1 size-5 shrink-0"
          checked={false}
          onCheckedChange={onComplete}
          aria-label={`Mark "${task.text}" done`}
        />

        <div className="min-w-0 flex-1">
          {linkedEntity ? (
            <Link
              to={linkedEntity.to}
              className="inline-flex min-w-0 max-w-full items-baseline gap-2 rounded-md text-xs font-semibold
                text-primary outline-none transition-colors duration-[160ms] hover:underline
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="min-w-0 truncate">{linkedEntity.label}</span>
              {linkedEntity.labelHe ? (
                <span className="font-hebrew shrink-0 text-muted-foreground" dir="rtl">
                  {linkedEntity.labelHe}
                </span>
              ) : null}
            </Link>
          ) : null}

          <p className="mt-0.5 text-sm leading-snug">{task.text}</p>

          <p
            className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 text-xs tabular-nums",
              overdue ? "text-attention-foreground" : "text-muted-foreground",
            )}
          >
            <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {overdue
              ? `Since ${formatDueMoment(task.due_date)}`
              : `Due ${formatDueMoment(task.due_date)}`}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground"
          onClick={onSnooze}
        >
          Snooze
        </Button>
      </div>
    </li>
  );
};

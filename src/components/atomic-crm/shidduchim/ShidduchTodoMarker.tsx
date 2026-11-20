import { AlertCircle, CircleCheck, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";

import { formatTodoWhen } from "./shidduchTodo";
import {
  useShidduchTodoSummary,
  useShidduchTodoSummaryStatus,
  useShidduchTodoVisibility,
} from "./ShidduchTodoSummaryContext";

export const ShidduchTodoMarker = ({
  shidduchId,
}: {
  shidduchId: string | number;
}) => {
  const canSee = useShidduchTodoVisibility();
  const status = useShidduchTodoSummaryStatus();
  const summary = useShidduchTodoSummary(shidduchId);
  if (!canSee || status !== "ready") return null;

  const label =
    summary.count === 0
      ? "No open to do"
      : summary.hasOverdue
        ? "Overdue to do"
        : `${summary.count} to do · ${formatTodoWhen(summary.earliestDueDate)}`;
  const isAmber = summary.count > 0 && !summary.hasOverdue && summary.isDueSoon;

  return (
    <span
      aria-label={label}
      data-slot="shidduch-todo-marker"
      className={cn(
        "mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium",
        summary.hasOverdue
          ? "bg-destructive/10 text-destructive"
          : isAmber
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "bg-muted text-muted-foreground",
      )}
    >
      {summary.hasOverdue ? (
        <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
      ) : summary.count > 0 ? (
        <ListChecks className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CircleCheck className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate" dir="auto">
        {label}
      </span>
    </span>
  );
};

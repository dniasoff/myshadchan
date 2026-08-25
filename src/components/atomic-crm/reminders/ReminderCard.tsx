import { ClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { RecordLink } from "../entity360/RecordLink";
import { formatDueMoment } from "../misc/formatDueMoment";
import { TaskAssigneeChip } from "../tasks/TaskAssigneeChip";
import { isOverdue } from "../tasks/tasksPredicate";
import { useTaskAssignees } from "../tasks/useTaskAssignees";
import { RESOURCE_FOR_TARGET } from "./reminderEntity";
import type { ReminderItem } from "./useReminders";

export interface ReminderCardProps {
  item: ReminderItem;
  onComplete: () => void;
  onSnooze: () => void;
  /** Staggered entrance delay in ms (design-language §4.3). */
  enterDelayMs?: number;
}

/**
 * One reminder row. Overdue reads as the honey "catch" surface (design-
 * language §5.8) — never red, never alarming — with a calm "Since {date}"
 * instead of a raw overdue count. Quick-complete and snooze are both
 * one-tap, ≥44px targets — snooze by its own `h-11`, complete by the
 * checkbox's transparent hit extension. This line used to assert that
 * guarantee while the checkbox was a bare 20px box; do not shrink either
 * back without rewriting it.
 */
export const ReminderCard = ({
  item,
  onComplete,
  onSnooze,
  enterDelayMs = 0,
}: ReminderCardProps) => {
  const { task, linkedEntity } = item;
  const overdue = isOverdue(task.due_date);
  // `ReminderList.tsx` (out of this story's ownership manifest) renders one
  // `ReminderCard` per item with no shared assignee map threaded down —
  // same reasoning as `tasks/Task.tsx`: react-query dedupes the identical
  // `context_members` query across every mounted card into one request.
  const { assigneesById, isMultiMember } = useTaskAssignees();

  return (
    <li className="ql-enter" style={{ animationDelay: `${enterDelayMs}ms` }}>
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition-[box-shadow,transform] duration-[160ms] ease-[var(--ease-out)] hover:shadow-md",
          overdue
            ? "border-[color-mix(in_oklch,var(--attention)_35%,transparent)] bg-[color-mix(in_oklch,var(--attention)_10%,transparent)]"
            : "border-border bg-card",
        )}
      >
        {/* The only way to complete a reminder on this surface. `-inset-3`
            on a size-5 box is exactly 44x44, and exactly the `gap-3` to its
            right — so it reaches the 44px floor without covering the first
            pixels of the linked-entity link. The box stays visually 20px:
            enlarging it would turn a reading list into a form (the same
            trade `entity360/tabs/TasksTab.tsx` documents). */}
        <Checkbox
          className="relative mt-1 size-5 shrink-0 before:absolute before:-inset-3 before:content-['']"
          checked={false}
          onCheckedChange={onComplete}
          aria-label={`Mark "${task.text}" done`}
        />

        <div className="min-w-0 flex-1">
          {linkedEntity ? (
            <RecordLink
              resource={RESOURCE_FOR_TARGET[linkedEntity.type]}
              id={linkedEntity.id}
              className="inline-flex min-w-0 max-w-full items-baseline gap-2 rounded-md text-xs font-semibold
                text-primary outline-none transition-colors duration-[160ms] hover:underline
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="min-w-0 truncate">{linkedEntity.label}</span>
            </RecordLink>
          ) : null}

          <p className="mt-0.5 text-sm leading-snug">{task.text}</p>

          <p
            className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 text-xs tabular-nums",
              overdue ? "text-attention-foreground" : "text-muted-foreground",
            )}
          >
            <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {/* Epic 12 review fix (R6): task.due_date is honestly nullable
                — formatDueMoment() is never called on a null value, which
                used to render "Since 1 Jan, 12:00 AM" via new Date(null)'s
                silent coercion to the Unix epoch. */}
            {task.due_date == null
              ? "No due date"
              : overdue
                ? `Since ${formatDueMoment(task.due_date)}`
                : `Due ${formatDueMoment(task.due_date)}`}
          </p>

          {/* AC-10: visible on every row once the household has more than
              one active member. */}
          <div className="mt-1.5">
            <TaskAssigneeChip
              memberId={task.member_id}
              assigneesById={assigneesById}
              isMultiMember={isMultiMember}
            />
          </div>
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

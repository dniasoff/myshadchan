import {
  isDueThisWeek,
  isDueToday,
  isDueTomorrow,
  isOverdue,
} from "../tasks/tasksPredicate";
import type { Task } from "../types";

export interface ShidduchTodoSummary {
  count: number;
  earliestDueDate: string | null;
  hasOverdue: boolean;
  isDueSoon: boolean;
}

export const EMPTY_SHIDDUCH_TODO_SUMMARY: ShidduchTodoSummary = {
  count: 0,
  earliestDueDate: null,
  hasOverdue: false,
  isDueSoon: false,
};

const isDueSoon = (date: string | null): boolean =>
  date != null &&
  !isOverdue(date) &&
  (isDueToday(date) || isDueTomorrow(date) || isDueThisWeek(date));

export const todoSummaryForTasks = (tasks: readonly Task[]) => {
  const summaries = new Map<string, ShidduchTodoSummary>();

  for (const task of tasks) {
    if (
      task.target_type !== "shidduch" ||
      task.target_id == null ||
      task.done_date != null
    ) {
      continue;
    }
    const key = String(task.target_id);
    const previous = summaries.get(key) ?? EMPTY_SHIDDUCH_TODO_SUMMARY;
    const dueDate = task.due_date;
    const earliestDueDate =
      previous.earliestDueDate == null ||
      (dueDate != null &&
        new Date(dueDate).getTime() <
          new Date(previous.earliestDueDate).getTime())
        ? dueDate
        : previous.earliestDueDate;

    summaries.set(key, {
      count: previous.count + 1,
      earliestDueDate,
      hasOverdue: previous.hasOverdue || isOverdue(dueDate),
      isDueSoon: previous.isDueSoon || isDueSoon(dueDate),
    });
  }

  return summaries;
};

import {
  isDueThisWeek,
  isDueToday,
  isDueTomorrow,
  isOverdue,
} from "../tasks/tasksPredicate";
import type { CrmDataProvider } from "../providers/types";
import type { Task } from "../types";

export const SHIDDUCH_TODO_PAGE_SIZE = 500;

/** Fetch every matching page so a large list cannot silently lose its counts. */
export const fetchAllOpenShidduchTasks = async (
  dataProvider: CrmDataProvider,
  shidduchIds: string[],
): Promise<Task[]> => {
  const tasks: Task[] = [];
  let page = 1;

  while (true) {
    const result = await dataProvider.getList<Task>("tasks", {
      filter: {
        target_type: "shidduch",
        "target_id@in": `(${shidduchIds.join(",")})`,
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page, perPage: SHIDDUCH_TODO_PAGE_SIZE },
    });

    tasks.push(...result.data);
    if (
      result.data.length === 0 ||
      (result.total != null && tasks.length >= result.total) ||
      result.data.length < SHIDDUCH_TODO_PAGE_SIZE
    ) {
      return tasks;
    }

    page += 1;
  }
};

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

import { startOfToday } from "date-fns/startOfToday";
import { endOfToday } from "date-fns/endOfToday";
import { endOfTomorrow } from "date-fns/endOfTomorrow";
import { endOfWeek } from "date-fns/endOfWeek";

import { isAfter } from "date-fns";

type Task = {
  due_date: string | null;
  done_date: string | null;
};

export const isDone = (task: Task) => task.done_date != null;

// A task is recently done if it was marked as done less than 5 minutes ago
// useful to keep recently done tasks in the list to avoid flickering when a task is marked as done while the user is consulting the list of tasks. It gives a chance to the user to see that the task was marked as done and then it will disappear after 5 minutes.
export const isRecentlyDone = (task: Task) =>
  task.done_date != null &&
  isAfter(new Date(task.done_date), new Date(Date.now() - 5 * 60 * 1000));

/**
 * Epic 12 review fix (R6): the ONE honest check for "does this task have a
 * due date at all" — a type predicate, so every predicate below narrows
 * `dateString` from `string | null` to `string` before calling `new
 * Date(dateString)`, rather than each repeating its own null check (or,
 * worse, none — `new Date(null)` returns the Unix epoch, not "Invalid
 * Date"; that silent coercion is exactly the bug the adversarial review
 * found: a no-date task rendered as overdue since 1 Jan, 12:00 AM). A task
 * with no due date matches NONE of `isOverdue`/`isDueToday`/
 * `isDueTomorrow`/`isDueThisWeek`/`isDueLater` — callers that need to
 * render or bucket it must check this explicitly, not assume every task
 * falls into exactly one of those five buckets.
 */
export const hasDueDate = (dateString: string | null): dateString is string =>
  dateString != null;

export const isOverdue = (dateString: string | null) => {
  if (!hasDueDate(dateString)) return false;
  return new Date(dateString) < startOfToday();
};

export const isDueToday = (dateString: string | null) => {
  if (!hasDueDate(dateString)) return false;
  const dueDate = new Date(dateString);
  return dueDate >= startOfToday() && dueDate < endOfToday();
};

export const isDueTomorrow = (dateString: string | null) => {
  if (!hasDueDate(dateString)) return false;
  const dueDate = new Date(dateString);
  return dueDate >= endOfToday() && dueDate < endOfTomorrow();
};

export const isDueThisWeek = (dateString: string | null) => {
  if (!hasDueDate(dateString)) return false;
  const dueDate = new Date(dateString);
  return (
    dueDate >= endOfTomorrow() &&
    dueDate < endOfWeek(new Date(), { weekStartsOn: 0 })
  );
};

export const isDueLater = (dateString: string | null) => {
  if (!hasDueDate(dateString)) return false;
  const dueDate = new Date(dateString);
  return dueDate >= endOfWeek(new Date(), { weekStartsOn: 0 });
};

import { addDays, format, getDay, startOfDay } from "date-fns";

import type { MemberRole } from "../types";

export type TodoQuickPick = "today" | "tomorrow" | "monday";

export const TODO_VISIBLE_ROLES = [
  "parent_admin",
  "self_manager",
  "helper",
  "shadchan",
] as const;

export const isTodoBoxVisible = (
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean =>
  !isRolePending &&
  role != null &&
  TODO_VISIBLE_ROLES.some((allowedRole) => allowedRole === role);

export const formatDateInput = (date: Date): string =>
  format(date, "yyyy-MM-dd");

export const getQuickPickDate = (
  pick: TodoQuickPick,
  now = new Date(),
): string => {
  const today = startOfDay(now);

  if (pick === "today") return formatDateInput(today);
  if (pick === "tomorrow") return formatDateInput(addDays(today, 1));

  // date-fns uses Sunday = 0. Keep Monday on the current week when today is
  // Monday; otherwise choose the next Monday in the current/next week.
  const daysUntilMonday = (1 - getDay(today) + 7) % 7;
  return formatDateInput(addDays(today, daysUntilMonday));
};

export const buildTaskDueDate = (date: string, time?: string): string => {
  const due = new Date(`${date}T${time || "00:00"}`);
  return due.toISOString();
};

export const formatTodoWhen = (date: string | null): string => {
  if (date == null) return "No date";

  const due = new Date(date);
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  if (due >= today && due < tomorrow) return "Today";
  if (due >= tomorrow && due < addDays(tomorrow, 1)) return "Tomorrow";

  // The weekday is the compact label used by the pipeline marker mockup.
  if (due >= today && due < addDays(today, 7)) {
    return format(due, "EEEE");
  }

  return format(due, "d MMM");
};

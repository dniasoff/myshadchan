import type { ReactElement } from "react";
import { Link } from "react-router";

import { buildTabPath } from "../entity360/entityPaths";
import {
  TaskReminderBox,
  TASK_REMINDER_TEXT_MAX_LENGTH,
  TODO_ADD_ERROR_MESSAGE,
  TODO_COMPLETE_ERROR_MESSAGE,
} from "../tasks/TaskReminderBox";
import type { ShidduchSummary } from "../types";

/** UI safety limit for quick-add text; tasks.text has no narrower DB constraint. */
export const TODO_TEXT_MAX_LENGTH = TASK_REMINDER_TEXT_MAX_LENGTH;
export { TODO_ADD_ERROR_MESSAGE, TODO_COMPLETE_ERROR_MESSAGE };

export interface ShidduchTodoBoxProps {
  shidduch: ShidduchSummary;
}

/**
 * The Overview keeps its To do box, but its task interactions are the same
 * shared reminder interactions used by the Reminders tab. Keeping this thin
 * adapter prevents the two task surfaces from drifting apart.
 */
export const ShidduchTodoBox = ({
  shidduch,
}: ShidduchTodoBoxProps): ReactElement | null => (
  <TaskReminderBox
    targetType="shidduch"
    targetId={shidduch.id}
    variant="todo"
    headingAccessory={
      <Link
        className="min-h-11 shrink-0 inline-flex items-center rounded-lg px-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        to={buildTabPath("shidduchim", shidduch.id, "tasks")}
      >
        See all tasks
      </Link>
    }
  />
);

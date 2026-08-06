import type { ReactElement } from "react";
import { useGetList, useResourceContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

import { TaskAssigneeChip } from "../../tasks/TaskAssigneeChip";
import { useTaskAssignees } from "../../tasks/useTaskAssignees";
import type { Task } from "../../types";
import { buildTabPath } from "../entityPaths";
import type { UniversalTabProps } from "./types";

/**
 * A read-only right-rail summary of a record's open tasks (Story 3.8,
 * contract §11 Ruling 2): the next `limit` incomplete tasks by due date,
 * plus one link into the canonical `TasksTab`. No add, no toggle, no edit,
 * no delete — `TasksTab.tsx` is the ONLY component in the codebase that
 * mutates tasks from a 360. `TasksRailSummary.guard.test.ts` proves this
 * file never imports a mutation hook or a form component.
 */
export interface TasksRailSummaryProps extends UniversalTabProps {
  /** How many incomplete tasks to show. Defaults to 3. */
  limit?: number;
}

/** AC 6 — loading placeholder, the pattern shared with every other tab. */
function TasksRailSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** AC 6 — an inline translated empty message. */
function TasksRailEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.tasks.empty", { _: "No tasks yet." })}
    </p>
  );
}

/** AC 6 — a translated fetch-error message; never a blank rail. The link
 * into the tab renders regardless (a failed read must not blank the
 * surface), so this component only owns the message itself. */
function TasksRailError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.tasks.error", {
        _: "Could not load the tasks.",
      })}
    </p>
  );
}

/** Ascending by `due_date`, undated tasks last. A tie-break, not a
 * substitute for the `getList` sort — see `selectVisibleTasks`'s doc
 * comment for why this exists at all. */
function compareByDueDate(a: Task, b: Task): number {
  if (a.due_date === b.due_date) return 0;
  if (a.due_date === null) return 1;
  if (b.due_date === null) return -1;
  return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
}

/**
 * AC 5(b)'s literal claim — given seven tasks, five incomplete and two
 * complete, exactly `limit` incomplete rows render, ordered by due date —
 * is about what this component RENDERS, not merely about what the
 * `getList` call above asked for. The query filter/sort/limit is the real
 * boundary this component trusts in production, but re-deriving the same
 * invariant here client-side means a provider that ignores `done_date@is`
 * or ships rows out of order still cannot put a completed task, or more
 * than `limit` rows, on the screen (review finding F4). Idempotent against
 * an already-filtered-and-sorted page: filtering a page with nothing done
 * and slicing to its own length are both no-ops.
 */
function selectVisibleTasks(tasks: readonly Task[], limit: number): Task[] {
  return tasks
    .filter((task) => task.done_date == null)
    .slice()
    .sort(compareByDueDate)
    .slice(0, limit);
}

export function TasksRailSummary({
  targetType,
  targetId,
  limit = 3,
}: TasksRailSummaryProps): ReactElement {
  const translate = useTranslate();
  const resource = useResourceContext();
  if (!resource) {
    throw new Error(
      "TasksRailSummary must be rendered within a ResourceContextProvider",
    );
  }

  const { data, error, isPending } = useGetList<Task>("tasks", {
    filter: {
      target_type: targetType,
      target_id: targetId,
      "done_date@is": null,
    },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: limit },
  });
  // AC-10: the assignee, visible on every row once the household has more
  // than one active member. `useTaskAssignees` is a read hook (useGetList
  // under the hood) — it does not violate Ruling 2's read-only requirement,
  // and `TaskAssigneeChip` is a pure display component (F6).
  const { assigneesById, isMultiMember } = useTaskAssignees();

  const tasks = selectVisibleTasks(data ?? [], limit);

  return (
    <div className="flex flex-col gap-2">
      {isPending ? (
        <TasksRailSkeleton />
      ) : error ? (
        <TasksRailError />
      ) : tasks.length === 0 ? (
        <TasksRailEmpty />
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={String(task.id)} className="text-sm">
              <p className="truncate">{task.text}</p>
              {task.due_date ? (
                <p className="text-xs text-muted-foreground">
                  {new Date(task.due_date).toLocaleDateString()}
                </p>
              ) : null}
              <div className="mt-1">
                <TaskAssigneeChip
                  memberId={task.member_id}
                  assigneesById={assigneesById}
                  isMultiMember={isMultiMember}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link
        to={buildTabPath(resource, targetId, "tasks")}
        className="text-sm underline"
      >
        {translate("crm.entity360.tasks.viewAll", { _: "See all tasks" })}
      </Link>
    </div>
  );
}

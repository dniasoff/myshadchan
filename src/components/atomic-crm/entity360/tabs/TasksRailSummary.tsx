import type { ReactElement } from "react";
import { useGetList, useResourceContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

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

  const tasks = data ?? [];

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

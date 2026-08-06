import { useMemo } from "react";
import { useGetIdentity, useGetList, useTimeout, useTranslate } from "ra-core";
import { useIsMobile } from "@/hooks/use-mobile";

import { TaskListFilter } from "./TasksListFilter";
import { TaskScopeToggle } from "./TaskScopeToggle";
import { useTaskAssigneeScope } from "./useTaskAssigneeScope";
import {
  isDone,
  isDueLater,
  isDueThisWeek,
  isDueToday,
  isDueTomorrow,
  isOverdue,
  isRecentlyDone,
} from "./tasksPredicate";

export const TasksListByDueDate = ({
  emptyPlaceholder,
  pendingPlaceholder,
}: {
  emptyPlaceholder?: React.ReactNode;
  pendingPlaceholder?: React.ReactNode;
}) => {
  const { identity } = useGetIdentity();
  const isMobile = useIsMobile();
  const translate = useTranslate();
  const [scope, setScope] = useTaskAssigneeScope();

  // AC-1/AC-2: Everyone (default) shows the whole household's tasks and
  // does not wait on identity at all; only the "mine" branch narrows to the
  // caller's own `member_id` and needs identity resolved first. This is the
  // one line that used to send `member_id: identity?.id` unconditionally —
  // see `taskScope.guard.test.ts`, which fails loudly if that regresses.
  const { data: tasks, isPending } = useGetList(
    "tasks",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "due_date", order: "ASC" },
      filter: scope === "mine" ? { member_id: identity?.id } : {},
    },
    { enabled: scope === "everyone" || !!identity },
  );

  const ongoingTasks = useMemo(
    () => tasks?.filter((task) => !isDone(task) || isRecentlyDone(task)) || [],
    [tasks],
  );

  const overdueTasks = useMemo(
    () =>
      ongoingTasks?.filter((task) => {
        return isOverdue(task.due_date);
      }) || [],
    [ongoingTasks],
  );

  const dueTodayTasks = useMemo(
    () =>
      ongoingTasks?.filter((task) => {
        return isDueToday(task.due_date);
      }) || [],
    [ongoingTasks],
  );

  const dueTomorrowTasks = useMemo(
    () => ongoingTasks?.filter((task) => isDueTomorrow(task.due_date)) || [],
    [ongoingTasks],
  );

  const dueThisWeekTasks = useMemo(
    () => ongoingTasks?.filter((task) => isDueThisWeek(task.due_date)) || [],
    [ongoingTasks],
  );

  const dueLaterTasks = useMemo(
    () => ongoingTasks?.filter((task) => isDueLater(task.due_date)) || [],
    [ongoingTasks],
  );

  const oneSecondHasPassed = useTimeout(1000);

  // AC-2: the toggle stays mounted through every state — pending, empty and
  // populated — so switching from "mine" back to "Everyone" is always
  // reachable, including from an empty "mine" result.
  const scopeToggle = <TaskScopeToggle scope={scope} onChange={setScope} />;

  if (isPending && oneSecondHasPassed) {
    return (
      <div className="flex flex-col gap-4">
        {scopeToggle}
        {pendingPlaceholder ?? null}
      </div>
    );
  }

  if (isPending) {
    return <div className="flex flex-col gap-4">{scopeToggle}</div>;
  }

  if (!ongoingTasks.length) {
    return (
      <div className="flex flex-col gap-4">
        {scopeToggle}
        {emptyPlaceholder ?? null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {scopeToggle}
      <TaskListFilter
        tasks={overdueTasks}
        title={translate("resources.tasks.filters.overdue")}
        isMobile={isMobile}
      />
      <TaskListFilter
        tasks={dueTodayTasks}
        title={translate("resources.tasks.filters.today")}
        isMobile={isMobile}
      />
      <TaskListFilter
        tasks={dueTomorrowTasks}
        title={translate("resources.tasks.filters.tomorrow")}
        isMobile={isMobile}
      />
      <TaskListFilter
        tasks={dueThisWeekTasks}
        title={translate("resources.tasks.filters.this_week")}
        isMobile={isMobile}
      />
      <TaskListFilter
        tasks={dueLaterTasks}
        title={translate("resources.tasks.filters.later")}
        isMobile={isMobile}
      />
    </div>
  );
};

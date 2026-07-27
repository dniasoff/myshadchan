import { useMemo } from "react";
import { useGetIdentity, useGetList, useTimeout, useTranslate } from "ra-core";
import { useIsMobile } from "@/hooks/use-mobile";

import { TaskListFilter } from "./TasksListFilter";
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

  const { data: tasks, isPending } = useGetList(
    "tasks",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "due_date", order: "ASC" },
      filter: { sales_id: identity?.id },
    },
    { enabled: !!identity },
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

  if (isPending && oneSecondHasPassed) {
    return pendingPlaceholder ?? null;
  }

  if (isPending) {
    return null;
  }

  if (!ongoingTasks.length) {
    return emptyPlaceholder ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
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

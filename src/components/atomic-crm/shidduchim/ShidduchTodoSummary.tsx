import { useMemo, type ReactNode } from "react";
import { useGetList, useListContext } from "ra-core";

import type { ShidduchSummary, Task } from "../types";
import { ShidduchTodoSummaryContext } from "./ShidduchTodoSummaryContext";
import { todoSummaryForTasks } from "./shidduchTodoSummary";

/**
 * One open-task query for the rows currently in the Shidduchim list. The
 * marker consumes this grouped result through context, so rendering rows in
 * Board, List, or Cards view never creates a query per row.
 */
export const ShidduchTodoSummaryProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { data } = useListContext<ShidduchSummary>();
  const shidduchIds = useMemo(
    () =>
      Array.from(new Set((data ?? []).map((shidduch) => String(shidduch.id)))),
    [data],
  );

  const { data: tasks } = useGetList<Task>(
    "tasks",
    {
      filter: {
        target_type: "shidduch",
        "target_id@in": `(${shidduchIds.join(",")})`,
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: shidduchIds.length > 0 },
  );

  const summaries = useMemo(() => todoSummaryForTasks(tasks ?? []), [tasks]);

  return (
    <ShidduchTodoSummaryContext.Provider value={summaries}>
      {children}
    </ShidduchTodoSummaryContext.Provider>
  );
};

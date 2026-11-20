import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useDataProvider, useListContext } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary, Task } from "../types";
import { useViewerRole } from "../entity360/useViewerRole";
import { isTodoBoxVisible } from "./shidduchTodo";
import {
  ShidduchTodoSummaryContext,
  ShidduchTodoSummaryStatusContext,
  ShidduchTodoVisibilityContext,
} from "./ShidduchTodoSummaryContext";
import {
  fetchAllOpenShidduchTasks,
  todoSummaryForTasks,
} from "./shidduchTodoSummary";
import type { ShidduchTodoSummaryStatus } from "./ShidduchTodoSummaryContext";

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
  const { role, isPending: isRolePending } = useViewerRole();
  const canSee = isTodoBoxVisible(role, isRolePending);
  const dataProvider = useDataProvider<CrmDataProvider>();
  const shidduchIds = useMemo(
    () =>
      Array.from(new Set((data ?? []).map((shidduch) => String(shidduch.id)))),
    [data],
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<ShidduchTodoSummaryStatus>("hidden");
  const shidduchIdsKey = shidduchIds.join(",");

  useEffect(() => {
    let cancelled = false;

    if (!canSee || shidduchIds.length === 0) {
      setTasks([]);
      setStatus(canSee ? "ready" : "hidden");
      return () => {
        cancelled = true;
      };
    }

    setTasks([]);
    setStatus("loading");
    void fetchAllOpenShidduchTasks(dataProvider, shidduchIds).then(
      (loadedTasks) => {
        if (!cancelled) {
          setTasks(loadedTasks);
          setStatus("ready");
        }
      },
      () => {
        if (!cancelled) {
          setTasks([]);
          setStatus("error");
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [canSee, dataProvider, shidduchIds, shidduchIdsKey]);

  const summaries = useMemo(
    () => (canSee ? todoSummaryForTasks(tasks) : new Map()),
    [canSee, tasks],
  );

  return (
    <ShidduchTodoVisibilityContext.Provider value={canSee}>
      <ShidduchTodoSummaryStatusContext.Provider value={status}>
        <ShidduchTodoSummaryContext.Provider value={summaries}>
          {children}
        </ShidduchTodoSummaryContext.Provider>
      </ShidduchTodoSummaryStatusContext.Provider>
    </ShidduchTodoVisibilityContext.Provider>
  );
};

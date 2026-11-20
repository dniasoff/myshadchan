import { useDataProvider } from "ra-core";
import type { Identifier } from "ra-core";
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import type { Task } from "../types";
import { isTodoBoxVisible } from "../shidduchim/shidduchTodo";

export interface ShadchanReminderSummary {
  count: number;
}

export const SHADCHAN_REMINDER_PAGE_SIZE = 500;
export const MAX_REMINDER_PAGES = 20;

/**
 * Fetch every open reminder for the visible shadchan ids in one account-scoped
 * provider query sequence. The provider applies the active-account visibility
 * boundary (Postgres RLS in production, with the same filter in FakeRest);
 * pagination continues until the complete result is known so a large account
 * cannot silently lose a marker.
 */
export const fetchAllOpenShadchanReminders = async (
  dataProvider: CrmDataProvider,
  shadchanIds: readonly string[],
): Promise<Task[]> => {
  const tasks: Task[] = [];
  let page = 1;

  while (true) {
    const result = await dataProvider.getList<Task>("tasks", {
      filter: {
        target_type: "shadchan",
        "target_id@in": `(${shadchanIds.join(",")})`,
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page, perPage: SHADCHAN_REMINDER_PAGE_SIZE },
    });
    tasks.push(...result.data);

    if (
      result.data.length === 0 ||
      result.data.length < SHADCHAN_REMINDER_PAGE_SIZE
    ) {
      return tasks;
    }

    if (page >= MAX_REMINDER_PAGES) {
      throw new Error("Could not load all reminder indicators safely.");
    }
    page += 1;
  }
};

export const summarizeOpenShadchanReminders = (
  tasks: readonly Task[],
  visibleShadchanIds: readonly string[],
): Map<string, ShadchanReminderSummary> => {
  const visibleIds = new Set(visibleShadchanIds);
  const summaries = new Map<string, ShadchanReminderSummary>();

  for (const task of tasks) {
    if (
      task.target_type !== "shadchan" ||
      task.target_id == null ||
      task.done_date != null
    ) {
      continue;
    }
    const shadchanId = String(task.target_id);
    if (!visibleIds.has(shadchanId)) continue;
    const previous = summaries.get(shadchanId);
    summaries.set(shadchanId, { count: (previous?.count ?? 0) + 1 });
  }

  return summaries;
};

export const useShadchanReminders = (shadchanIds: readonly Identifier[]) => {
  const { role, isPending: isRolePending } = useViewerRole();
  const canSee = isTodoBoxVisible(role, isRolePending);
  const dataProvider = useDataProvider<CrmDataProvider>();
  const normalizedIds = useMemo(
    () =>
      Array.from(new Set(shadchanIds.map((id) => String(id)))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [shadchanIds],
  );

  const query = useQuery({
    queryKey: ["shadchanim", "live-reminder-indicators", normalizedIds],
    enabled: canSee && normalizedIds.length > 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    queryFn: () => fetchAllOpenShadchanReminders(dataProvider, normalizedIds),
  });

  const remindersByShadchanId = useMemo(
    () =>
      canSee && !query.isPending && !query.error
        ? summarizeOpenShadchanReminders(query.data ?? [], normalizedIds)
        : new Map<string, ShadchanReminderSummary>(),
    [canSee, normalizedIds, query.data, query.error, query.isPending],
  );

  return {
    remindersByShadchanId,
    isPending: canSee && normalizedIds.length > 0 && query.isPending,
    error: canSee && normalizedIds.length > 0 ? query.error : null,
  };
};

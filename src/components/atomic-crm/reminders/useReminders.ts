import { addDays } from "date-fns";
import type { Identifier } from "ra-core";
import {
  useGetIdentity,
  useGetList,
  useGetMany,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useMemo } from "react";

import { isOverdue } from "../tasks/tasksPredicate";
import type { TaskAssigneeScope } from "../tasks/useTaskAssigneeScope";
import type { Task, TaskTargetType } from "../types";
import { RESOURCE_FOR_TARGET, targetEntityLabel } from "./reminderEntity";

/**
 * No `to: string` field — `ReminderCard` resolves the path by rendering
 * `RecordLink` with `RESOURCE_FOR_TARGET[type]`/`id` (contract §7), so this
 * type carries only what `RecordLink` cannot derive itself.
 */
export interface LinkedEntityRef {
  type: TaskTargetType;
  id: Identifier;
  label: string;
}

export interface ReminderItem {
  task: Task;
  linkedEntity: LinkedEntityRef | null;
}

export interface UseRemindersResult {
  isPending: boolean;
  overdue: ReminderItem[];
  upcoming: ReminderItem[];
  isEmpty: boolean;
  complete: (task: Task) => Promise<void>;
  snooze: (task: Task) => Promise<void>;
}

const ALL_TARGET_TYPES: TaskTargetType[] = [
  "shidduch",
  "reference",
  "shadchan",
  "single",
  // Story 8.5 (Task 8): 'connection' joins the widened ENTITY_TARGET_TYPES
  // union — see useLinkedEntityRecords below for the matching fifth
  // useGetMany call this addition requires.
  "connection",
];

/** ids of open tasks grouped by target_type, deduplicated. */
const groupIdsByTargetType = (
  tasks: Task[],
): Map<TaskTargetType, Identifier[]> => {
  const map = new Map<TaskTargetType, Identifier[]>();
  ALL_TARGET_TYPES.forEach((type) => map.set(type, []));
  tasks.forEach((task) => {
    if (!task.target_type || task.target_id == null) return;
    const bucket = map.get(task.target_type);
    if (bucket && !bucket.includes(task.target_id)) {
      bucket.push(task.target_id);
    }
  });
  return map;
};

/**
 * One `useGetMany` per target type — the set of types is fixed
 * (`ALL_TARGET_TYPES`), so these five hooks always run in the same order.
 * Only fires a request when that type actually has ids to look up. A fifth
 * target type needs a fifth hook call here, not just a fifth map entry —
 * `useGetMany` cannot be called in a loop over `ALL_TARGET_TYPES` without
 * breaking the rules of hooks (a variable number of hook calls).
 */
const useLinkedEntityRecords = (
  idsByType: Map<TaskTargetType, Identifier[]>,
) => {
  const shidduchIds = idsByType.get("shidduch") ?? [];
  const referenceIds = idsByType.get("reference") ?? [];
  const shadchanIds = idsByType.get("shadchan") ?? [];
  const singleIds = idsByType.get("single") ?? [];
  const connectionIds = idsByType.get("connection") ?? [];

  const shidduchim = useGetMany(
    RESOURCE_FOR_TARGET.shidduch,
    { ids: shidduchIds },
    { enabled: shidduchIds.length > 0 },
  );
  const references = useGetMany(
    RESOURCE_FOR_TARGET.reference,
    { ids: referenceIds },
    { enabled: referenceIds.length > 0 },
  );
  const shadchanim = useGetMany(
    RESOURCE_FOR_TARGET.shadchan,
    { ids: shadchanIds },
    { enabled: shadchanIds.length > 0 },
  );
  const singles = useGetMany(
    RESOURCE_FOR_TARGET.single,
    { ids: singleIds },
    { enabled: singleIds.length > 0 },
  );
  const connections = useGetMany(
    RESOURCE_FOR_TARGET.connection,
    { ids: connectionIds },
    { enabled: connectionIds.length > 0 },
  );

  return useMemo(() => {
    const byType: [TaskTargetType, Identifier[], typeof shidduchim][] = [
      ["shidduch", shidduchIds, shidduchim],
      ["reference", referenceIds, references],
      ["shadchan", shadchanIds, shadchanim],
      ["single", singleIds, singles],
      ["connection", connectionIds, connections],
    ];
    const lookup = new Map<string, Record<string, unknown>>();
    let isPending = false;
    byType.forEach(([type, ids, result]) => {
      if (ids.length > 0 && result.isPending) isPending = true;
      (result.data ?? []).forEach((record) => {
        lookup.set(`${type}:${record.id}`, record as Record<string, unknown>);
      });
    });
    return { lookup, isPending };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the five query results are the only inputs; idsByType is derived from them.
  }, [shidduchim, references, shadchanim, singles, connections]);
};

/**
 * The reminders hub's data: open (`done_date is null`) tasks, split into
 * overdue and upcoming, each resolved against the entity it is linked to
 * (FR44-46, AD-13's polymorphic target_type/target_id) so the card can show
 * a real name and link out to it.
 *
 * `scope` (AC-2) mirrors `TasksListByDueDate.tsx`'s own Everyone/Mine
 * split, under the SAME `useTaskAssigneeScope` store key — Ruling 4 forbids
 * a second, `/reminders`-only notion of "mine".
 */
export const useReminders = (
  scope: TaskAssigneeScope = "everyone",
): UseRemindersResult => {
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [update] = useUpdate();
  const { identity } = useGetIdentity();

  const { data: tasks, isPending: tasksPending } = useGetList<Task>(
    "tasks",
    {
      filter:
        scope === "mine"
          ? { "done_date@is": null, member_id: identity?.id }
          : { "done_date@is": null },
      pagination: { page: 1, perPage: 200 },
      sort: { field: "due_date", order: "ASC" },
    },
    { enabled: scope === "everyone" || !!identity },
  );

  const openTasks = useMemo(() => tasks ?? [], [tasks]);
  const idsByType = useMemo(() => groupIdsByTargetType(openTasks), [openTasks]);
  const { lookup, isPending: entitiesPending } =
    useLinkedEntityRecords(idsByType);

  const items = useMemo<ReminderItem[]>(
    () =>
      openTasks.map((task) => {
        if (!task.target_type || task.target_id == null) {
          return { task, linkedEntity: null };
        }
        const record = lookup.get(`${task.target_type}:${task.target_id}`);
        const { label } = targetEntityLabel(task.target_type, record);
        return {
          task,
          linkedEntity: {
            type: task.target_type,
            id: task.target_id,
            label,
          },
        };
      }),
    [openTasks, lookup],
  );

  const overdue = items.filter((item) => isOverdue(item.task.due_date));
  const upcoming = items.filter((item) => !isOverdue(item.task.due_date));

  const isPending = tasksPending || entitiesPending;

  const complete = async (task: Task): Promise<void> => {
    try {
      await update(
        "tasks",
        {
          id: task.id,
          data: { done_date: new Date().toISOString() },
          previousData: task,
        },
        { returnPromise: true },
      );
      refresh();
      notify(
        translate("crm.reminders.complete.done", { _: "Done — nice work." }),
        { type: "success" },
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Failed to complete the reminder",
        { type: "error" },
      );
    }
  };

  const snooze = async (task: Task): Promise<void> => {
    const base = isOverdue(task.due_date)
      ? new Date()
      : new Date(task.due_date);
    try {
      await update(
        "tasks",
        {
          id: task.id,
          data: { due_date: addDays(base, 1).toISOString() },
          previousData: task,
        },
        { returnPromise: true },
      );
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Failed to snooze the reminder",
        { type: "error" },
      );
    }
  };

  return {
    isPending,
    overdue,
    upcoming,
    isEmpty: !isPending && overdue.length === 0 && upcoming.length === 0,
    complete,
    snooze,
  };
};

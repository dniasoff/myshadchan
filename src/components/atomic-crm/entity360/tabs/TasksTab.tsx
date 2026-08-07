import { useState } from "react";
import type { ReactElement } from "react";
import type { Identifier } from "ra-core";
import {
  useCreate,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { TaskAssigneeChip } from "../../tasks/TaskAssigneeChip";
import { TaskAssigneeSelect } from "../../tasks/TaskAssigneeSelect";
import { useTaskAssignees } from "../../tasks/useTaskAssignees";
import type { Task } from "../../types";
import type { UniversalTabProps } from "./types";

/**
 * The universal Tasks tab (Story 3.8, contract §8, Ruling 2). Generalises
 * `references/ReferenceTasks.tsx` — the working, record-scoped
 * implementation this tab was built from — by parameterising both
 * `target_type` and `target_id` instead of hardcoding `"reference"` /
 * `referenceId`. Story 5.10 deleted `ReferenceTasks.tsx` once this tab
 * covered its behaviour.
 *
 * `TasksTab` is the ONLY component in the codebase that mutates tasks from a
 * 360 — `TasksRailSummary.tsx` is a read-only summary (Ruling 2). Takes
 * exactly `UniversalTabProps`: no extra props, no per-entity variant, no
 * default `targetType`.
 */

/** AC 6 — loading placeholder, the pattern shared with ActivityTab/NotesTab. */
function TasksSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

/** AC 6 — an inline translated empty message; the add form above it stays usable. */
function TasksEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.tasks.empty", { _: "No tasks yet." })}
    </p>
  );
}

/** AC 6 — a translated fetch-error message; never a blank tab, and the add
 * form above it stays usable. */
function TasksError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.tasks.error", {
        _: "Could not load the tasks.",
      })}
    </p>
  );
}

export function TasksTab({
  targetType,
  targetId,
}: UniversalTabProps): ReactElement {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isCreating }] = useCreate<Task>();
  const [update] = useUpdate();
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Story 12.3 (AC-11): `undefined` = not chosen -> omitted from the create
  // payload, letting the server default (`set_member_id_default()`) apply;
  // `null` = explicitly Unassigned; a number = that member's id.
  const [assigneeId, setAssigneeId] = useState<Identifier | null | undefined>(
    undefined,
  );

  const { data, error, isPending } = useGetList<Task>("tasks", {
    filter: { target_type: targetType, target_id: targetId },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: 50 },
  });
  const { assigneesById, isMultiMember } = useTaskAssignees();

  const tasks = data ?? [];

  // AC 3(c) / Story 12.3 AC-11: `account_id` and `delivery_channels` stay
  // server-set and client-unsendable. `member_id` is now client-sendable —
  // this story adds a server-side validator (`validate_task_assignee`)
  // alongside the pre-existing if-null default, so it is safe to include
  // when the caller actually chose an assignee, and omitted (not sent as
  // `null`) when they didn't, letting the default apply exactly as before.
  const handleAdd = async () => {
    const trimmed = text.trim();
    if (trimmed === "") return;

    try {
      await create(
        "tasks",
        {
          data: {
            target_type: targetType,
            target_id: targetId,
            text: trimmed,
            // Omitted rather than sent as an explicit `null` when empty: the
            // column is nullable and an absent key lands the same NULL, but
            // sending `null` through a field `Task` declares as `string` is
            // the drift documented on that type. Same shape as `member_id`
            // just below.
            ...(dueDate === ""
              ? {}
              : { due_date: new Date(dueDate).toISOString() }),
            ...(assigneeId !== undefined ? { member_id: assigneeId } : {}),
          },
        },
        { returnPromise: true },
      );
      setText("");
      setDueDate("");
      setAssigneeId(undefined);
      refresh();
    } catch (err) {
      // AC 6 mutation-failure state: the text the user typed is NOT cleared
      // on a rejected create, so their input is not lost.
      notify(
        err instanceof Error
          ? err.message
          : translate("crm.entity360.tasks.addError", {
              _: "Failed to add the task",
            }),
        { type: "error" },
      );
    }
  };

  const handleToggle = async (task: Task) => {
    try {
      await update(
        "tasks",
        {
          id: task.id,
          data: {
            done_date: task.done_date ? null : new Date().toISOString(),
          },
          previousData: task,
        },
        { returnPromise: true },
      );
      refresh();
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message
          : translate("crm.entity360.tasks.toggleError", {
              _: "Failed to update the task",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={translate("crm.entity360.tasks.placeholder", {
            _: "Add a task…",
          })}
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="sm:w-44"
          aria-label={translate("crm.entity360.tasks.dueDate", {
            _: "Due date",
          })}
        />
        <TaskAssigneeSelect
          value={assigneeId}
          onChange={setAssigneeId}
          className="sm:w-44"
          ariaLabel={translate("crm.tasks.assignee.label", {
            _: "Assignee",
          })}
        />
        <Button
          type="button"
          disabled={isCreating || text.trim() === ""}
          onClick={handleAdd}
        >
          {translate("crm.entity360.tasks.add", { _: "Add task" })}
        </Button>
      </div>

      {isPending ? (
        <TasksSkeleton />
      ) : error ? (
        <TasksError />
      ) : tasks.length === 0 ? (
        <TasksEmpty />
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={String(task.id)} className="flex items-start gap-3">
              <Checkbox
                checked={Boolean(task.done_date)}
                onCheckedChange={() => handleToggle(task)}
                aria-label={task.text}
                className="mt-1"
              />
              <div className="min-w-0">
                <p
                  className={
                    task.done_date ? "text-muted-foreground line-through" : ""
                  }
                >
                  {task.text}
                </p>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

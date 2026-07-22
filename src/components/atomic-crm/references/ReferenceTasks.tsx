import { useState } from "react";
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
import type { Task } from "../types";

/**
 * Follow-up reminders on a reference (FR43-46), written against the polymorphic
 * tasks shape (AD-13) rather than a reference-only table.
 *
 * Delivery is in-app plus email; the database default is ["in_app", "email"] and
 * there is deliberately no SMS channel. Scheduling/notification delivery itself
 * belongs to the reminders epic — this creates the task and marks it done.
 */
export const ReferenceTasks = ({
  referenceId,
}: {
  referenceId: Identifier;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isCreating }] = useCreate();
  const [update] = useUpdate();
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");

  const { data } = useGetList<Task>("tasks", {
    filter: { target_type: "reference", target_id: referenceId },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "due_date", order: "ASC" },
  });

  const tasks = data ?? [];

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (trimmed === "") return;

    try {
      await create(
        "tasks",
        {
          data: {
            target_type: "reference",
            target_id: referenceId,
            text: trimmed,
            due_date: dueDate === "" ? null : new Date(dueDate).toISOString(),
          },
        },
        { returnPromise: true },
      );
      setText("");
      setDueDate("");
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add the reminder",
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
          data: { done_date: task.done_date ? null : new Date().toISOString() },
          previousData: task,
        },
        { returnPromise: true },
      );
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Failed to update the reminder",
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
          placeholder={translate("crm.references.tasks.placeholder", {
            _: "Remind me to...",
          })}
          className="min-h-[44px]"
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="min-h-[44px] sm:w-44"
          aria-label={translate("crm.references.tasks.dueDate", {
            _: "Due date",
          })}
        />
        <Button
          type="button"
          className="min-h-[44px]"
          disabled={isCreating || text.trim() === ""}
          onClick={handleAdd}
        >
          {translate("crm.references.tasks.add", { _: "Add reminder" })}
        </Button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("crm.references.tasks.empty", {
            _: "No reminders on this person.",
          })}
        </p>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

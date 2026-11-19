import { useRef, useState, type ReactElement } from "react";
import { Link } from "react-router";
import {
  useCreate,
  useGetList,
  useNotify,
  useRefresh,
  useUpdate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { buildTabPath } from "../entity360/entityPaths";
import { useViewerRole } from "../entity360/useViewerRole";
import { formatDueMoment } from "../misc/formatDueMoment";
import type { ShidduchSummary, Task } from "../types";
import {
  buildTaskDueDate,
  getQuickPickDate,
  isTodoBoxVisible,
  type TodoQuickPick,
} from "./shidduchTodo";

export interface ShidduchTodoBoxProps {
  shidduch: ShidduchSummary;
}

export const ShidduchTodoBox = ({
  shidduch,
}: ShidduchTodoBoxProps): ReactElement | null => {
  const { role, isPending: isRolePending } = useViewerRole();
  const canSee = isTodoBoxVisible(role, isRolePending);
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isCreating }] = useCreate<Task>();
  const [update] = useUpdate();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const {
    data,
    error,
    isPending: isTasksPending,
  } = useGetList<Task>(
    "tasks",
    {
      filter: {
        target_type: "shidduch",
        target_id: shidduch.id,
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: canSee },
  );

  if (!canSee) return null;

  const tasks = data ?? [];
  const trimmedText = text.trim();

  const handleQuickPick = (pick: TodoQuickPick) => {
    setDate(getQuickPickDate(pick));
  };

  const handleAdd = async () => {
    if (trimmedText === "" || isCreating) return;

    try {
      await create(
        "tasks",
        {
          data: {
            target_type: "shidduch",
            target_id: shidduch.id,
            text: trimmedText,
            ...(date ? { due_date: buildTaskDueDate(date, time) } : {}),
          },
        },
        { returnPromise: true },
      );
      setText("");
      setDate("");
      setTime("");
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add the to do",
        {
          type: "error",
        },
      );
    }
  };

  const handleToggle = async (task: Task) => {
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
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to complete the to do",
        { type: "error" },
      );
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">To do</h3>
        <Link
          className="min-h-11 shrink-0 inline-flex items-center rounded-lg px-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          to={buildTabPath("shidduchim", shidduch.id, "tasks")}
        >
          See all tasks
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="shidduch-todo-text">What do I need to do?</Label>
          <Input
            id="shidduch-todo-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="What do I need to do?"
            placeholder="What do I need to do?"
            dir="auto"
          />
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Quick due date picks">
          <Button
            type="button"
            variant={
              date === getQuickPickDate("today") ? "secondary" : "outline"
            }
            className="min-h-11"
            onClick={() => handleQuickPick("today")}
          >
            Today
          </Button>
          <Button
            type="button"
            variant={
              date === getQuickPickDate("tomorrow") ? "secondary" : "outline"
            }
            className="min-h-11"
            onClick={() => handleQuickPick("tomorrow")}
          >
            Tomorrow
          </Button>
          <Button
            type="button"
            variant={
              date === getQuickPickDate("monday") ? "secondary" : "outline"
            }
            className="min-h-11"
            onClick={() => handleQuickPick("monday")}
          >
            Monday
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => dateInputRef.current?.focus()}
          >
            Pick a date
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="shidduch-todo-date">Date</Label>
            <Input
              ref={dateInputRef}
              id="shidduch-todo-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Date"
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="shidduch-todo-time">Time (optional)</Label>
            <Input
              id="shidduch-todo-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              aria-label="Time (optional)"
              className="min-h-11"
            />
          </div>
        </div>

        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={trimmedText === "" || isCreating}
          onClick={() => void handleAdd()}
        >
          Add to do
        </Button>
      </div>

      <div className="mt-5 flex flex-col divide-y">
        {isTasksPending ? (
          <p className="py-3 text-sm text-muted-foreground" aria-busy="true">
            Loading to dos…
          </p>
        ) : error ? (
          <p className="py-3 text-sm text-destructive" role="alert">
            Could not load the to dos.
          </p>
        ) : tasks.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No open to do</p>
        ) : (
          tasks.slice(0, 5).map((task) => (
            <label
              key={task.id}
              className="flex min-h-11 min-w-0 items-center gap-3 py-3"
            >
              <Checkbox
                checked={false}
                onCheckedChange={() => void handleToggle(task)}
                aria-label={`Mark ${task.text} complete`}
              />
              <span className="min-w-0 flex-1 break-words text-sm" dir="auto">
                {task.text}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {task.due_date ? formatDueMoment(task.due_date) : "No date"}
              </span>
            </label>
          ))
        )}
      </div>
    </section>
  );
};

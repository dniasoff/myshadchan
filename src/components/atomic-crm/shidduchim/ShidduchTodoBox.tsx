import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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

/** UI safety limit for quick-add text; tasks.text has no narrower DB constraint. */
export const TODO_TEXT_MAX_LENGTH = 500;
export const TODO_ADD_ERROR_MESSAGE =
  "Could not add the to do. Please try again.";
export const TODO_COMPLETE_ERROR_MESSAGE =
  "Could not complete the to do. Please try again.";

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
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusAfterCompletion, setFocusAfterCompletion] = useState<{
    taskId: string | null;
  } | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const todoListRef = useRef<HTMLDivElement>(null);
  const pendingTaskIdsRef = useRef(new Set<string>());

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

  const tasks = useMemo(() => data ?? [], [data]);
  const trimmedText = text.trim();

  useEffect(() => {
    if (focusAfterCompletion == null) return;

    if (focusAfterCompletion.taskId == null) {
      headingRef.current?.focus();
      setFocusAfterCompletion(null);
      return;
    }

    const nextCheckbox = Array.from(
      todoListRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ??
        [],
    ).find(
      (element) =>
        element.getAttribute("data-task-id") === focusAfterCompletion.taskId,
    );

    if (nextCheckbox == null) return;

    nextCheckbox.focus();
    setFocusAfterCompletion(null);
  }, [focusAfterCompletion, tasks]);

  if (!canSee) return null;

  const handleQuickPick = (pick: TodoQuickPick) => {
    setDate(getQuickPickDate(pick));
  };

  const handleAdd = async () => {
    if (
      trimmedText === "" ||
      trimmedText.length > TODO_TEXT_MAX_LENGTH ||
      isCreating
    )
      return;

    setStatusMessage("");

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
      setStatusMessage("To do added");
      textInputRef.current?.focus();
      refresh();
    } catch {
      notify(TODO_ADD_ERROR_MESSAGE, { type: "error" });
    }
  };

  const handleToggle = async (task: Task) => {
    const taskId = String(task.id);
    if (pendingTaskIdsRef.current.has(taskId)) return;

    pendingTaskIdsRef.current.add(taskId);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    setStatusMessage("");

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
      const visibleTasks = tasks.slice(0, 5);
      const taskIndex = visibleTasks.findIndex(
        (visibleTask) => String(visibleTask.id) === taskId,
      );
      const nextTask = taskIndex >= 0 ? visibleTasks[taskIndex + 1] : undefined;

      setFocusAfterCompletion({
        taskId: nextTask == null ? null : String(nextTask.id),
      });
      setStatusMessage("To do completed");
      refresh();
    } catch {
      notify(TODO_COMPLETE_ERROR_MESSAGE, { type: "error" });
    } finally {
      pendingTaskIdsRef.current.delete(taskId);
      setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    }
  };

  return (
    <section
      aria-labelledby="shidduch-todo-heading"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          ref={headingRef}
          id="shidduch-todo-heading"
          tabIndex={-1}
          className="font-display text-lg font-semibold outline-none"
        >
          To do
        </h3>
        <Link
          className="min-h-11 shrink-0 inline-flex items-center rounded-lg px-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          to={buildTabPath("shidduchim", shidduch.id, "tasks")}
        >
          See all tasks
        </Link>
      </div>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusMessage}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="shidduch-todo-text">What do I need to do?</Label>
            <span
              id="shidduch-todo-text-count"
              className={
                text.length > TODO_TEXT_MAX_LENGTH
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {text.length}/{TODO_TEXT_MAX_LENGTH}
            </span>
          </div>
          <Input
            ref={textInputRef}
            id="shidduch-todo-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="What do I need to do?"
            aria-describedby="shidduch-todo-text-count"
            maxLength={TODO_TEXT_MAX_LENGTH}
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
          disabled={
            trimmedText === "" ||
            trimmedText.length > TODO_TEXT_MAX_LENGTH ||
            isCreating
          }
          onClick={() => void handleAdd()}
        >
          Add to do
        </Button>
      </div>

      <div ref={todoListRef} className="mt-5 flex flex-col divide-y">
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
                data-task-id={String(task.id)}
                disabled={pendingTaskIds.has(String(task.id))}
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

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useRefresh,
  useUpdate,
} from "ra-core";
import type { Identifier, UseDeleteOptions } from "ra-core";

import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatDueMoment } from "../misc/formatDueMoment";
import { useViewerRole } from "../entity360/useViewerRole";
import type { Task } from "../types";
import {
  buildTaskDueDate,
  getQuickPickDate,
  isTodoBoxVisible,
  type TodoQuickPick,
} from "../shidduchim/shidduchTodo";
import { formatTaskTime, parseTaskTime } from "./taskTime";

export type ReminderTargetType = "shidduch" | "shadchan";

export interface TaskReminderBoxProps {
  targetType: ReminderTargetType;
  targetId: Identifier;
  /** Use the same task interaction model for the shidduch Overview To do box. */
  variant?: "reminder" | "todo";
  headingAccessory?: ReactNode;
}

export const TASK_REMINDER_TEXT_MAX_LENGTH = 500;
export const TODO_ADD_ERROR_MESSAGE =
  "Could not add the to do. Please try again.";
export const TODO_COMPLETE_ERROR_MESSAGE =
  "Could not complete the to do. Please try again.";
const ADD_ERROR = "Could not add the reminder. Please try again.";
const UPDATE_ERROR = "Could not update the reminder. Please try again.";
const COMPLETE_ERROR = "Could not complete the reminder. Please try again.";
const TIME_ERROR = "We couldn't read that time. Try 9:34 PM.";
const EMPTY_TASKS: Task[] = [];

const inputId = (
  targetType: ReminderTargetType,
  targetId: Identifier,
  part: string,
) => `reminder-${targetType}-${String(targetId)}-${part}`;

const dateInputValue = (value: string | null): string => {
  if (value == null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const timeInputValue = (value: string | null): string => {
  if (value == null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // `buildTaskDueDate` stores date-only reminders at the end of the local
  // day. Keep those reminders date-only when they are edited.
  if (
    date.getHours() === 23 &&
    date.getMinutes() === 59 &&
    date.getSeconds() === 59
  ) {
    return "";
  }
  return formatTaskTime(
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`,
  );
};

const isOverdue = (task: Task): boolean =>
  task.done_date == null &&
  task.due_date != null &&
  !Number.isNaN(Date.parse(task.due_date)) &&
  Date.parse(task.due_date) < Date.now();

interface ReminderRowProps {
  task: Task;
  itemLabel: "reminder" | "to do";
  isToggling: boolean;
  onToggle: (task: Task) => Promise<boolean>;
  onChanged: () => void;
  onFocusAfterToggle: (taskId: string | null) => void;
  onFocusAfterDelete: (taskId: string, nextTaskId: string | null) => void;
  onFocusAfterUndo: (taskId: string) => void;
  nextTaskId: string | null;
}

const ReminderRow = ({
  task,
  itemLabel,
  isToggling,
  onToggle,
  onChanged,
  onFocusAfterToggle,
  onFocusAfterDelete,
  onFocusAfterUndo,
  nextTaskId,
}: ReminderRowProps): ReactElement => {
  const notify = useNotify();
  const refresh = useRefresh();
  const [update, { isPending: isUpdating }] = useUpdate();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [editDate, setEditDate] = useState(dateInputValue(task.due_date));
  const [editTime, setEditTime] = useState(timeInputValue(task.due_date));
  const [timeError, setTimeError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const editTimeId = `reminder-${String(task.id)}-edit-time`;
  const editTimeErrorId = `${editTimeId}-error`;
  const editTextRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const actionGuardRef = useRef<"save" | "delete" | null>(null);
  const undoActivationRef = useRef(false);

  const focusSoon = (getElement: () => HTMLElement | null) => {
    requestAnimationFrame(() => getElement()?.focus());
  };

  const cancelEditing = () => {
    setTimeError("");
    setIsEditing(false);
    focusSoon(() => editButtonRef.current);
  };

  useEffect(() => {
    if (!isEditing) return;
    const frame = requestAnimationFrame(() => editTextRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  const deleteOptions: UseDeleteOptions<Task> & { onUndo?: () => void } = {
    mutationMode: "undoable",
    onSuccess: () => {
      refresh();
      onChanged();
      notify("Deleted. Undo is available for 10 seconds.", {
        type: "info",
        undoable: true,
        autoHideDuration: 10_000,
      });
    },
    onUndo: () => {
      if (undoActivationRef.current) return;
      undoActivationRef.current = true;
      actionGuardRef.current = null;
      onChanged();
      onFocusAfterUndo(String(task.id));
      setTimeout(() => {
        undoActivationRef.current = false;
      }, 0);
    },
    onError: () => {
      actionGuardRef.current = null;
      notify(`Could not delete the ${itemLabel}. Please try again.`, {
        type: "error",
      });
    },
  };
  const [deleteTask, { isPending: isDeleting }] = useDelete<Task>(
    "tasks",
    {
      id: task.id,
      previousData: task,
    },
    deleteOptions,
  );

  useEffect(() => {
    if (!isEditing) {
      setEditText(task.text);
      setEditDate(dateInputValue(task.due_date));
      setEditTime(timeInputValue(task.due_date));
    }
  }, [isEditing, task.due_date, task.text]);

  const normaliseTime = (): boolean => {
    if (editTime.trim() === "") {
      setTimeError("");
      return true;
    }
    const parsed = parseTaskTime(editTime);
    if (parsed == null) {
      setTimeError(TIME_ERROR);
      return false;
    }
    setEditTime(parsed.display);
    setTimeError("");
    return true;
  };

  const handleEditSave = async () => {
    if (editText.trim() === "" || !normaliseTime()) return;
    const parsedTime = editTime.trim() === "" ? null : parseTaskTime(editTime);
    if (editTime.trim() !== "" && parsedTime == null) return;
    if (actionGuardRef.current != null || undoActivationRef.current) return;
    actionGuardRef.current = "save";

    try {
      await update(
        "tasks",
        {
          id: task.id,
          data: {
            text: editText.trim(),
            ...(editDate
              ? {
                  due_date: buildTaskDueDate(editDate, parsedTime?.value),
                }
              : { due_date: null }),
          },
          previousData: task,
        },
        { returnPromise: true },
      );
      setIsEditing(false);
      setTimeError("");
      onChanged();
      refresh();
      focusSoon(() => editButtonRef.current);
    } catch {
      notify(UPDATE_ERROR, { type: "error" });
      focusSoon(() => editTextRef.current);
    } finally {
      actionGuardRef.current = null;
    }
  };

  const handleToggle = async () => {
    if (await onToggle(task)) onFocusAfterToggle(nextTaskId);
  };

  return (
    <li className="flex min-w-0 flex-col gap-3 border-b py-4 last:border-b-0">
      {isEditing ? (
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
        >
          <Label htmlFor={`reminder-${String(task.id)}-edit-text`}>
            What do I need to do?
          </Label>
          <Input
            ref={editTextRef}
            id={`reminder-${String(task.id)}-edit-text`}
            value={editText}
            maxLength={TASK_REMINDER_TEXT_MAX_LENGTH}
            onChange={(event) => setEditText(event.target.value)}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`reminder-${String(task.id)}-edit-date`}>
                Date
              </Label>
              <Input
                id={`reminder-${String(task.id)}-edit-date`}
                type="date"
                value={editDate}
                onChange={(event) => setEditDate(event.target.value)}
                className="min-h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={editTimeId}>Time (optional)</Label>
              <Input
                id={editTimeId}
                value={editTime}
                inputMode="text"
                placeholder="for example 9:34 PM"
                aria-label="Edit time (optional)"
                aria-invalid={Boolean(timeError)}
                aria-describedby={timeError ? editTimeErrorId : undefined}
                onChange={(event) => {
                  setEditTime(event.target.value);
                  if (timeError) setTimeError("");
                }}
                onBlur={normaliseTime}
                onKeyDown={(event) => {
                  if (event.key === "Enter") normaliseTime();
                }}
                className="min-h-11"
              />
              {timeError ? (
                <p
                  id={editTimeErrorId}
                  role="alert"
                  className="text-sm text-destructive"
                  aria-live="polite"
                >
                  {timeError}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={isUpdating}
              onClick={() => void handleEditSave()}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={cancelEditing}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox
            checked={false}
            data-task-id={String(task.id)}
            aria-label={`Mark ${task.text} complete`}
            disabled={isDeleting || isToggling}
            onCheckedChange={() => void handleToggle()}
            className="relative mt-1 min-h-4 min-w-4 before:absolute before:-inset-3.5 before:content-['']"
          />
          <div className="min-w-0 flex-1">
            <p className="break-words text-base" dir="auto">
              {task.text}
            </p>
            <p
              className={
                isOverdue(task)
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {task.due_date ? formatDueMoment(task.due_date) : "No date"}
              {isOverdue(task) ? " · Overdue" : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              ref={editButtonRef}
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11 gap-1 px-2"
              data-edit-task-id={String(task.id)}
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
            <Button
              ref={deleteButtonRef}
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11 gap-1 px-2 text-destructive hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={isDeleting}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      )}
      <Confirm
        isOpen={confirmOpen}
        title="Delete this to-do?"
        cancel="Cancel"
        confirm="Delete"
        confirmColor="warning"
        loading={isDeleting}
        onClose={() => {
          setConfirmOpen(false);
          focusSoon(() => deleteButtonRef.current);
        }}
        onConfirm={(event) => {
          if (actionGuardRef.current != null || undoActivationRef.current)
            return;
          actionGuardRef.current = "delete";
          setConfirmOpen(false);
          onFocusAfterDelete(String(task.id), nextTaskId);
          event.stopPropagation();
          deleteTask(
            "tasks",
            { id: task.id, previousData: task },
            { mutationMode: "undoable" },
          );
        }}
      />
    </li>
  );
};

export const TaskReminderBox = ({
  targetType,
  targetId,
  variant = "reminder",
  headingAccessory,
}: TaskReminderBoxProps): ReactElement | null => {
  const isTodo = variant === "todo";
  const heading = isTodo ? "To do" : "Reminders";
  const itemLabel = isTodo ? "to do" : "reminder";
  const itemLabelPlural = isTodo ? "to dos" : "reminders";
  const loadingLabel = isTodo ? "to dos" : "reminders";
  const addButtonLabel = isTodo ? "Add to do" : "Add reminder";
  const addedStatus = isTodo ? "To do added" : "Reminder added";
  const completedStatus = isTodo ? "To do completed" : "Reminder completed";
  const addError = isTodo ? TODO_ADD_ERROR_MESSAGE : ADD_ERROR;
  const completeError = isTodo ? TODO_COMPLETE_ERROR_MESSAGE : COMPLETE_ERROR;
  const { role, isPending: isRolePending } = useViewerRole();
  const canSee = isTodoBoxVisible(role, isRolePending);
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isCreating }] = useCreate<Task>();
  const [update] = useUpdate();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeError, setTimeError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingTaskIdsRef = useRef(new Set<string>());
  const [focusAfterCompletion, setFocusAfterCompletion] = useState<
    string | null | undefined
  >(undefined);
  const [focusAfterDelete, setFocusAfterDelete] = useState<
    | { kind: "delete"; taskId: string; nextTaskId: string | null }
    | { kind: "edit"; taskId: string }
    | null
  >(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputPrefix = inputId(targetType, targetId, "");
  const textCountId = `${inputPrefix}text-count`;

  const {
    data,
    error,
    isPending: isTasksPending,
  } = useGetList<Task>(
    "tasks",
    {
      filter: {
        target_type: targetType,
        target_id: targetId,
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: canSee },
  );
  const tasks = data ?? EMPTY_TASKS;

  useEffect(() => {
    if (focusAfterCompletion === undefined) return;
    if (focusAfterCompletion === null) {
      headingRef.current?.focus();
    } else {
      Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ?? [],
      )
        .find((element) => element.dataset.taskId === focusAfterCompletion)
        ?.focus();
    }
    setFocusAfterCompletion(undefined);
  }, [focusAfterCompletion, tasks]);

  useEffect(() => {
    if (focusAfterDelete == null) return;
    let attempts = 0;
    let frame = 0;
    let timeout = 0;
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        !element.hidden &&
        element.getAttribute("aria-hidden") !== "true" &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const focusTarget = () => {
      let target: HTMLElement | null = null;
      if (focusAfterDelete.kind === "delete") {
        target =
          focusAfterDelete.nextTaskId == null
            ? null
            : (Array.from(
                listRef.current?.querySelectorAll<HTMLButtonElement>(
                  "[data-edit-task-id]",
                ) ?? [],
              ).find(
                (element) =>
                  element.dataset.editTaskId === focusAfterDelete.nextTaskId &&
                  isVisible(element),
              ) ?? null);
        target ??= headingRef.current;
      } else {
        target =
          Array.from(
            listRef.current?.querySelectorAll<HTMLButtonElement>(
              "[data-edit-task-id]",
            ) ?? [],
          ).find(
            (element) => element.dataset.editTaskId === focusAfterDelete.taskId,
          ) ?? null;
      }
      if (target == null) {
        if (attempts++ < 30) frame = requestAnimationFrame(focusTarget);
        return;
      }
      target.focus();
      if (attempts++ < 12) {
        frame = requestAnimationFrame(focusTarget);
        return;
      }
      setFocusAfterDelete(null);
    };
    if (focusAfterDelete.kind === "edit") {
      // The toast action dismisses itself after calling onUndo. Defer the
      // focus until that dismissal has finished so it cannot move focus back
      // to the heading after this effect focuses the restored row.
      timeout = window.setTimeout(focusTarget, 0);
    } else {
      frame = requestAnimationFrame(focusTarget);
    }
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [focusAfterDelete, tasks]);

  if (!canSee) return null;

  const normaliseAddTime = (): boolean => {
    if (time.trim() === "") {
      setTimeError("");
      return true;
    }
    const parsed = parseTaskTime(time);
    if (parsed == null) {
      setTimeError(TIME_ERROR);
      return false;
    }
    setTime(parsed.display);
    setTimeError("");
    return true;
  };

  const handleQuickPick = (pick: TodoQuickPick) =>
    setDate(getQuickPickDate(pick));

  const handleAdd = async () => {
    const trimmedText = text.trim();
    if (
      trimmedText === "" ||
      trimmedText.length > TASK_REMINDER_TEXT_MAX_LENGTH ||
      isCreating ||
      !normaliseAddTime()
    )
      return;
    const parsedTime = time.trim() === "" ? null : parseTaskTime(time);
    if (time.trim() !== "" && parsedTime == null) return;
    setStatusMessage("");
    try {
      await create(
        "tasks",
        {
          data: {
            target_type: targetType,
            target_id: targetId,
            text: trimmedText,
            ...(date
              ? { due_date: buildTaskDueDate(date, parsedTime?.value) }
              : {}),
          },
        },
        { returnPromise: true },
      );
      setText("");
      setDate("");
      setTime("");
      setTimeError("");
      setStatusMessage(addedStatus);
      textInputRef.current?.focus();
      refresh();
    } catch {
      notify(addError, { type: "error" });
    }
  };

  const handleToggle = async (task: Task): Promise<boolean> => {
    const taskId = String(task.id);
    if (pendingTaskIdsRef.current.has(taskId)) return false;
    pendingTaskIdsRef.current.add(taskId);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
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
      setStatusMessage(completedStatus);
      refresh();
    } catch {
      notify(completeError, { type: "error" });
      return false;
    } finally {
      pendingTaskIdsRef.current.delete(taskId);
      setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    }
    return true;
  };

  return (
    <section
      aria-labelledby={`${inputPrefix}heading`}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          id={`${inputPrefix}heading`}
          className="font-display text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {heading}
        </h2>
        {headingAccessory}
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
            <Label htmlFor={`${inputPrefix}text`}>What do I need to do?</Label>
            <span
              id={textCountId}
              className={
                text.length > TASK_REMINDER_TEXT_MAX_LENGTH
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {text.length}/{TASK_REMINDER_TEXT_MAX_LENGTH}
            </span>
          </div>
          <Input
            ref={textInputRef}
            id={`${inputPrefix}text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="What do I need to do?"
            aria-describedby={textCountId}
            maxLength={TASK_REMINDER_TEXT_MAX_LENGTH}
            placeholder="What do I need to do?"
            dir="auto"
            className="min-h-11"
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Quick due date picks">
          {(["today", "tomorrow", "monday"] as const).map((pick) => (
            <Button
              key={pick}
              type="button"
              variant={
                date === getQuickPickDate(pick) ? "secondary" : "outline"
              }
              className="min-h-11"
              onClick={() => handleQuickPick(pick)}
            >
              {pick === "today"
                ? "Today"
                : pick === "tomorrow"
                  ? "Tomorrow"
                  : "Monday"}
            </Button>
          ))}
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
            <Label htmlFor={`${inputPrefix}date`}>Date</Label>
            <Input
              ref={dateInputRef}
              id={`${inputPrefix}date`}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${inputPrefix}time`}>Time (optional)</Label>
            <Input
              id={`${inputPrefix}time`}
              value={time}
              inputMode="text"
              placeholder="for example 9:34 PM"
              aria-invalid={Boolean(timeError)}
              aria-describedby={
                timeError ? `${inputPrefix}time-error` : undefined
              }
              onChange={(event) => {
                setTime(event.target.value);
                if (timeError) setTimeError("");
              }}
              onBlur={normaliseAddTime}
              onKeyDown={(event) => {
                if (event.key === "Enter") normaliseAddTime();
              }}
              className="min-h-11"
            />
            {timeError ? (
              <p
                id={`${inputPrefix}time-error`}
                role="alert"
                aria-live="polite"
                className="text-sm text-destructive"
              >
                {timeError}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={text.trim() === "" || isCreating}
          onClick={() => void handleAdd()}
        >
          {addButtonLabel}
        </Button>
      </div>

      <ul ref={listRef} className="mt-5 flex flex-col">
        {isTasksPending ? (
          <li className="py-3 text-sm text-muted-foreground" aria-busy="true">
            Loading {loadingLabel}…
          </li>
        ) : error ? (
          <li className="py-3 text-sm text-destructive" role="alert">
            Could not load the {itemLabelPlural}.
          </li>
        ) : tasks.length === 0 ? (
          <li className="py-3 text-sm text-muted-foreground">
            No open {itemLabelPlural}
          </li>
        ) : (
          tasks.map((task, index) => (
            <ReminderRow
              key={String(task.id)}
              task={task}
              itemLabel={itemLabel}
              isToggling={pendingTaskIds.has(String(task.id))}
              onToggle={handleToggle}
              onChanged={refresh}
              onFocusAfterToggle={setFocusAfterCompletion}
              onFocusAfterDelete={(taskId, nextTaskId) => {
                setFocusAfterDelete({
                  kind: "delete",
                  taskId,
                  nextTaskId,
                });
              }}
              onFocusAfterUndo={(taskId) => {
                setFocusAfterDelete({ kind: "edit", taskId });
              }}
              nextTaskId={
                index + 1 < tasks.length ? String(tasks[index + 1].id) : null
              }
            />
          ))
        )}
      </ul>
    </section>
  );
};

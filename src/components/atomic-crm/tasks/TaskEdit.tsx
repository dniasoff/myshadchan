import {
  EditBase,
  Form,
  useDelete,
  useNotify,
  useSaveContext,
  useTranslate,
  type Identifier,
  type FormProps,
  type MutationMode,
  type UseDeleteOptions,
} from "ra-core";
import {
  useRef,
  useState,
  type BaseSyntheticEvent,
  type MouseEvent,
  type MutableRefObject,
} from "react";
import type { FieldValues } from "react-hook-form";
import { SaveButton } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/admin/confirm";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TaskFormContent } from "./TaskFormContent";
import type { Task as TaskRecord } from "../types";

/**
 * Deliberate, named exemption from UX-DR3 ("records live at URLs, not in
 * modals", AD-24) — recorded here per Story 3.13 AC 4, not silently skipped.
 * Four grounds, one sentence each:
 *
 * 1. UX-DR3 scopes the rule to "primary records"; a task is not one.
 * 2. The primary-record set is the set of entities with an `EntityDescriptor`
 *    and a 360 (`shidduchim`, `singles`, `shadchanim`, `references`); `tasks`
 *    is a registered resource but gets no descriptor through Epic 11.
 * 3. A task is a dependent row — it carries `target_type`/`target_id` and is
 *    reached from its target's Tasks tab or the global `/tasks` list, never
 *    as a subject in its own right.
 * 4. Routing this editor would need `buildEditPath("tasks", id)`, which
 *    throws (`requireEntityDescriptor` has no `tasks` entry by design); the
 *    only alternative — hand-building the path — is forbidden by the Epic 3
 *    API contract §4.
 *
 * `TaskEditSheet.tsx` is this dialog's mobile presentation of the same
 * `TaskFormContent`, chosen by `useIsMobile()` in `Task.tsx` — a second
 * responsive presentation of one form, not a second implementation.
 *
 * Reopening trigger: the first story that registers an `EntityDescriptor`
 * for `tasks` moves this editor to `/tasks/{id}/edit` (built with
 * `buildEditPath`) and removes `TaskEdit.tsx` from the AC 5 allowlist in
 * `misc/recordSurfaceDialogs.guard.test.ts`.
 */
export const TaskEdit = ({
  open,
  close,
  taskId,
  onDelete,
  onUndo,
  mutationMode,
}: {
  taskId: Identifier;
  open: boolean;
  close: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  mutationMode?: MutationMode;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  const saveActivationRef = useRef(false);
  const deleteActivationRef = useRef(false);
  const undoActivationRef = useRef(false);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutationOptions: UseDeleteOptions & { onUndo?: () => void } = {
    onSuccess: () => {
      close();
      onDelete?.();
      notify("Deleted. Undo is available for 10 seconds.", {
        type: "info",
        undoable: true,
      });
    },
    onUndo: () => {
      if (undoActivationRef.current) return;
      undoActivationRef.current = true;
      deleteActivationRef.current = false;
      onUndo?.();
      setTimeout(() => {
        undoActivationRef.current = false;
      }, 0);
    },
    onError: () => {
      deleteActivationRef.current = false;
    },
    onSettled: () => {
      deleteActivationRef.current = false;
    },
  };
  const [deleteTask] = useDelete<TaskRecord>(
    "tasks",
    { id: taskId },
    deleteMutationOptions,
  );
  return (
    <Dialog open={open} onOpenChange={close}>
      {open && taskId && (
        <EditBase
          id={taskId}
          resource="tasks"
          className="mt-0"
          mutationOptions={{
            onSuccess: () => {
              close();
              notify("resources.tasks.updated", {
                type: "info",
                undoable: true,
              });
            },
            onError: () => {
              saveActivationRef.current = false;
            },
            onSettled: () => {
              saveActivationRef.current = false;
            },
          }}
          redirect={false}
          mutationMode={mutationMode}
        >
          <TaskEditForm
            taskId={taskId}
            translate={translate}
            saveActivationRef={saveActivationRef}
            deleteActivationRef={deleteActivationRef}
            undoActivationRef={undoActivationRef}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            deleteTask={deleteTask}
            deleteButtonRef={deleteButtonRef}
          />
        </EditBase>
      )}
    </Dialog>
  );
};

interface TaskEditFormProps {
  taskId: Identifier;
  translate: ReturnType<typeof useTranslate>;
  saveActivationRef: MutableRefObject<boolean>;
  deleteActivationRef: MutableRefObject<boolean>;
  undoActivationRef: MutableRefObject<boolean>;
  confirmDelete: boolean;
  setConfirmDelete: (open: boolean) => void;
  deleteTask: ReturnType<typeof useDelete<TaskRecord>>[0];
  deleteButtonRef: MutableRefObject<HTMLButtonElement | null>;
}

const TaskEditForm = ({
  taskId,
  translate,
  saveActivationRef,
  deleteActivationRef,
  undoActivationRef,
  confirmDelete,
  setConfirmDelete,
  deleteTask,
  deleteButtonRef,
}: TaskEditFormProps) => {
  const saveContext = useSaveContext();

  const handleFormSubmit: FormProps["onSubmit"] = (
    values: FieldValues,
    event?: BaseSyntheticEvent,
  ) => {
    if (saveActivationRef.current) return false;
    // This handler is called by react-hook-form only after validation. An
    // invalid attempt therefore leaves the guard available for correction.
    saveActivationRef.current = true;
    return saveContext?.save?.(values, event as never);
  };

  const requestDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (deleteActivationRef.current || undoActivationRef.current) return;
    setConfirmDelete(true);
  };

  return (
    <>
      <DialogContent className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
        <Form className="flex flex-col gap-4" onSubmit={handleFormSubmit}>
          <DialogHeader>
            <DialogTitle>
              {translate("resources.tasks.action.edit")}
            </DialogTitle>
          </DialogHeader>
          <TaskFormContent />
          <DialogFooter className="w-full sm:justify-between gap-4">
            <Button
              ref={deleteButtonRef}
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={requestDelete}
            >
              Delete
            </Button>
            <SaveButton label="ra.action.save" className="min-h-11" />
          </DialogFooter>
        </Form>
      </DialogContent>
      <Confirm
        isOpen={confirmDelete}
        title="Delete this task?"
        cancel="Cancel"
        confirm="Delete"
        confirmColor="warning"
        onClose={() => {
          setConfirmDelete(false);
          requestAnimationFrame(() => deleteButtonRef.current?.focus());
        }}
        onConfirm={(event) => {
          if (deleteActivationRef.current || undoActivationRef.current) return;
          deleteActivationRef.current = true;
          setConfirmDelete(false);
          event.stopPropagation();
          deleteTask("tasks", { id: taskId }, { mutationMode: "undoable" });
        }}
      />
    </>
  );
};

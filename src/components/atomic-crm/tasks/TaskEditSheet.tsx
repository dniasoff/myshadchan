import {
  useDelete,
  useNotify,
  useTranslate,
  type Identifier,
  type MutationMode,
  type UseDeleteOptions,
} from "ra-core";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/admin/confirm";
import { EditSheet, type EditSheetFormSubmit } from "../misc/EditSheet";
import type { Task as TaskRecord } from "../types";
import { TaskFormContent } from "./TaskFormContent";

export interface TaskEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: Identifier;
  mutationMode?: MutationMode;
  onDeleteStart?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
}

export const TaskEditSheet = ({
  open,
  onOpenChange,
  taskId,
  mutationMode,
  onDeleteStart,
  onDelete,
  onUndo,
}: TaskEditSheetProps) => {
  const notify = useNotify();
  const translate = useTranslate();
  const saveActivationRef = useRef(false);
  const deleteActivationRef = useRef(false);
  const undoActivationRef = useRef(false);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleFormSubmit: EditSheetFormSubmit = () => {
    if (saveActivationRef.current) return false;
    // This callback runs only after react-hook-form validation. Unlike a
    // button onClick guard, an invalid attempt therefore leaves the form
    // available for correction and a later valid submit.
    saveActivationRef.current = true;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  const deleteMutationOptions: UseDeleteOptions & { onUndo?: () => void } = {
    onSuccess: () => {
      onOpenChange(false);
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
  };
  const [deleteTask] = useDelete<TaskRecord>(
    "tasks",
    { id: taskId },
    deleteMutationOptions,
  );

  const requestDelete = () => {
    if (deleteActivationRef.current || undoActivationRef.current) return;
    setConfirmDelete(true);
  };

  return (
    <>
      <EditSheet
        resource="tasks"
        id={taskId}
        title={
          <span className="text-xl font-semibold truncate pr-10">
            {translate("resources.tasks.sheet.edit")}
          </span>
        }
        redirect={false}
        open={open}
        onOpenChange={handleOpenChange}
        mutationMode={mutationMode}
        formOnSubmit={handleFormSubmit}
        mutationOptions={{
          onSettled: () => {
            saveActivationRef.current = false;
          },
        }}
        footerActions={
          <Button
            ref={deleteButtonRef}
            type="button"
            variant="destructive"
            className="flex-1 h-12"
            onClick={requestDelete}
          >
            Delete
          </Button>
        }
      >
        <TaskFormContent />
      </EditSheet>
      <Confirm
        isOpen={confirmDelete}
        title="Delete this to-do?"
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
          onDeleteStart?.();
          event.stopPropagation();
          deleteTask("tasks", { id: taskId }, { mutationMode: "undoable" });
        }}
      />
    </>
  );
};

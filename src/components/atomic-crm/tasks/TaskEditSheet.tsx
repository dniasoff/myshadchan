import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { EditSheet } from "../misc/EditSheet";
import { TaskFormContent } from "./TaskFormContent";

export interface TaskEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: Identifier;
}

export const TaskEditSheet = ({
  open,
  onOpenChange,
  taskId,
}: TaskEditSheetProps) => {
  const translate = useTranslate();
  return (
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
      onOpenChange={onOpenChange}
    >
      <TaskFormContent />
    </EditSheet>
  );
};

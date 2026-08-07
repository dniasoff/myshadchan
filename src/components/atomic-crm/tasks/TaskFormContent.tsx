import { required, useTranslate } from "ra-core";
import { useController } from "react-hook-form";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { DateTimeInput } from "@/components/admin";
import { Label } from "@/components/ui/label";

import type { Task } from "../types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { TaskAssigneeSelect } from "./TaskAssigneeSelect";

export const TaskFormContent = () => {
  const { taskTypes } = useConfigurationContext();
  const translate = useTranslate();
  // `TaskAssigneeSelect` is a plain `value`/`onChange` component (it also
  // has to work inside ReminderCreateSheet.tsx/TasksTab.tsx, neither of
  // which is a react-hook-form context) — `useController` is what wires it
  // into THIS form, the one react-hook-form surface (Story 12.3, AC-3).
  // `ra-core`'s `<Form>` wraps its children in react-hook-form's
  // `FormProvider`, so `control` resolves from context without being passed
  // explicitly.
  const { field: assigneeField } = useController<Pick<Task, "member_id">>({
    name: "member_id",
  });

  return (
    <div className="flex flex-col gap-4">
      <TextInput
        autoFocus
        source="text"
        validate={required()}
        multiline
        className="m-0"
        helperText={false}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DateTimeInput
          source="due_date"
          helperText={false}
          validate={required()}
        />
        <SelectInput
          source="type"
          validate={required()}
          choices={taskTypes}
          optionText="label"
          optionValue="value"
          defaultValue="none"
          helperText={false}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="task-assignee">
            {translate("crm.tasks.assignee.label", { _: "Assignee" })}
          </Label>
          <TaskAssigneeSelect
            id="task-assignee"
            value={assigneeField.value ?? null}
            onChange={assigneeField.onChange}
          />
        </div>
      </div>
    </div>
  );
};

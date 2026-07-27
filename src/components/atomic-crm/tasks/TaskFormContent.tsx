import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { required } from "ra-core";
import { DateTimeInput } from "@/components/admin";

import { useConfigurationContext } from "../root/ConfigurationContext";

export const TaskFormContent = () => {
  const { taskTypes } = useConfigurationContext();
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>
    </div>
  );
};

import { required } from "ra-core";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Separator } from "@/components/ui/separator";

/**
 * Form inputs for a single (the person being matched). account_id is
 * set server-side by a trigger — never a form input.
 */
export type SingleInputsProps = {
  mode: "create" | "edit";
};

export const SingleInputs = ({ mode }: SingleInputsProps) => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Name</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          source="first_name_en"
          label="First name"
          validate={required()}
          helperText={false}
        />
        <TextInput source="last_name_en" label="Last name" helperText={false} />
      </div>
    </div>

    <Separator />

    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Details</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectInput
          source="gender"
          choices={[
            { id: "unknown", name: "Unknown" },
            { id: "female", name: "Female" },
            { id: "male", name: "Male" },
          ]}
          defaultValue="unknown"
          helperText={false}
        />
        <DateInput source="dob" label="Date of birth" helperText={false} />
        {mode === "edit" && (
          <SelectInput
            className="sm:col-span-2"
            source="status"
            choices={[
              { id: "active", name: "Active" },
              { id: "paused", name: "Paused" },
              // 2.5 AC-8: read-only — the only writer of 'archived' is
              // remove_persona() (a persona-removal side effect, never a
              // direct edit). Listed so an archived single's edit form has a
              // matching choice instead of rendering blank and silently
              // resetting to "active" on save; disabled so it can never be
              // chosen going the other way.
              { id: "archived", name: "Archived", disabled: true },
            ]}
            defaultValue="active"
            helperText={false}
          />
        )}
      </div>
      {mode === "create" && (
        <p className="text-sm text-muted-foreground">
          You can update the name, gender, or date of birth later from Edit
          single.
        </p>
      )}
    </div>
  </div>
);

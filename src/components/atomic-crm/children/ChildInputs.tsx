import { required } from "ra-core";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Separator } from "@/components/ui/separator";

/**
 * Form inputs for a child (the single/child being matched). Bilingual name
 * fields are paired side-by-side (AD-12) so English and Hebrew stay visually
 * linked without ever being jammed into one input. account_id is set
 * server-side by a trigger — never a form input.
 */
export const ChildInputs = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Name</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          source="first_name_en"
          label="First name (EN)"
          validate={required()}
          helperText={false}
        />
        <TextInput
          source="first_name_he"
          label="First name (HE)"
          inputClassName="font-hebrew text-end"
          dir="rtl"
          helperText={false}
        />
        <TextInput
          source="last_name_en"
          label="Last name (EN)"
          helperText={false}
        />
        <TextInput
          source="last_name_he"
          label="Last name (HE)"
          inputClassName="font-hebrew text-end"
          dir="rtl"
          helperText={false}
        />
      </div>
    </div>

    <Separator />

    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Details</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectInput
          source="gender"
          choices={[
            { id: "female", name: "Female" },
            { id: "male", name: "Male" },
          ]}
          helperText={false}
        />
        <TextInput source="community" helperText={false} />
        <DateInput source="dob" label="Date of birth" helperText={false} />
        <SelectInput
          source="status"
          choices={[
            { id: "active", name: "Active" },
            { id: "paused", name: "Paused" },
          ]}
          defaultValue="active"
          helperText={false}
        />
      </div>
    </div>
  </div>
);

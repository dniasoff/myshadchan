import { required } from "ra-core";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";

/**
 * Form inputs for a child (the single/child being matched). Bilingual name
 * fields (AD-12). account_id is set server-side by a trigger — never a form input.
 */
export const ChildInputs = () => (
  <>
    <TextInput
      source="first_name_en"
      label="First name (EN)"
      validate={required()}
      helperText={false}
    />
    <TextInput
      source="first_name_he"
      label="First name (HE)"
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
      helperText={false}
    />
    <SelectInput
      source="gender"
      choices={[
        { id: "female", name: "Female" },
        { id: "male", name: "Male" },
      ]}
      helperText={false}
    />
    <TextInput source="community" helperText={false} />
    <SelectInput
      source="status"
      choices={[
        { id: "active", name: "Active" },
        { id: "paused", name: "Paused" },
      ]}
      defaultValue="active"
      helperText={false}
    />
  </>
);

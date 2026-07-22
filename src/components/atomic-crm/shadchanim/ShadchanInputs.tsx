import { required } from "ra-core";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";

/**
 * Form inputs for a shadchan (matchmaker). account_id is set server-side by a
 * trigger — never a form input.
 */
export const ShadchanInputs = () => (
  <>
    <TextInput source="name" validate={required()} helperText={false} />
    <TextInput source="name_he" label="Name (HE)" helperText={false} />
    <TextInput source="location" helperText={false} />
    <SelectInput
      source="responsiveness"
      choices={[
        { id: "high", name: "High" },
        { id: "medium", name: "Medium" },
        { id: "low", name: "Low" },
      ]}
      helperText={false}
    />
    <TextInput source="notes" multiline rows={3} helperText={false} />
  </>
);

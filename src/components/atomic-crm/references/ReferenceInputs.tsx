import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";

/**
 * Form inputs for a reference. account_id and the *_norm match keys are set
 * server-side by triggers (AD-1/AD-5) and are never form inputs — the SPA does
 * not normalize and does not choose a tenant.
 *
 * Both name scripts are first-class (AD-12): a reference entered in Hebrew must
 * be as findable as one entered in English.
 */
export const ReferenceInputs = () => (
  <>
    <TextInput source="name_en" label="Name (EN)" helperText={false} />
    <TextInput source="name_he" label="Name (HE)" helperText={false} />
    <TextInput
      source="relationship"
      helperText="How they know the single - teacher, neighbour, family friend..."
    />
    <TextInput source="phone" helperText={false} />
    <TextInput source="school" helperText={false} />
    <NumberInput
      source="grad_year"
      label="Graduation year"
      helperText={false}
    />
  </>
);

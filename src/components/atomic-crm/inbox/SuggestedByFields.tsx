import { TextInput } from "@/components/admin/text-input";

import {
  validateSuggestedByName,
  validateSuggestedByPhone,
} from "./suggestedBy";

/**
 * The From block is shared by Inbox, resume-first filing, and ShareTarget.
 * A phone is kept exactly as the person typed it (after trimming) and never
 * enters a URL, log, or storage key.
 */
export const SuggestedByFields = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
    <div>
      <h3 className="font-medium">From</h3>
      <p className="text-xs text-muted-foreground">Optional</p>
    </div>
    <TextInput
      source="suggested_by_name"
      id="suggested_by_name"
      label="Suggested by"
      dir="auto"
      validate={validateSuggestedByName}
      helperText={false}
    />
    <TextInput
      source="suggested_by_phone"
      id="suggested_by_phone"
      label="Phone number"
      dir="ltr"
      inputMode="tel"
      autoComplete="tel"
      inputClassName="h-11 min-h-11"
      helperText={
        <span
          id="suggested_by_phone-description"
          className="text-xs text-muted-foreground"
        >
          Optional. Use digits, spaces, +, dashes, or parentheses.
        </span>
      }
      validate={validateSuggestedByPhone}
    />
  </div>
);

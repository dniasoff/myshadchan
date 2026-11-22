import { TextInput } from "@/components/admin/text-input";

import {
  displaySuggestedByPhone,
  validateSuggestedByName,
  validateSuggestedByPhone,
} from "./suggestedBy";

/**
 * The From block is shared by Inbox, resume-first filing, and ShareTarget.
 * A phone's edge decoration is cleaned for the field display and on newly
 * entered values. Persisted data is never rewritten merely by rendering it.
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
      format={displaySuggestedByPhone}
      parse={displaySuggestedByPhone}
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

import type { ChangeEvent, ReactElement } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * One opt-in row: a `Switch` gating whether the field is published at all,
 * plus its value control — shared by every listing publish form (Story 9.1's
 * three shadchan toggles, Story 9.2's seven single toggles) so a new field
 * never needs its own markup. Extracted out of
 * `PublishShadchanListingSection.tsx` in Story 9.2 (`.claude/rules/
 * coding-style.md`, DRY) rather than copy-pasted a second time.
 */
export function ListingToggleField({
  id,
  label,
  checked,
  onCheckedChange,
  value,
  onValueChange,
  placeholder,
  multiline = false,
  inputType = "text",
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  /** Passed straight through to the underlying `<input type=…>` — `number`
   * for Story 9.2's age field, `text` (the default) for everything else. */
  inputType?: "text" | "number";
  disabled: boolean;
}): ReactElement {
  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onValueChange(event.target.value);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </div>
      {checked ? (
        multiline ? (
          <Textarea
            aria-label={label}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            rows={2}
            disabled={disabled}
          />
        ) : (
          <Input
            type={inputType}
            aria-label={label}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
          />
        )
      ) : null}
    </div>
  );
}

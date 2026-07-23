import type { InputProps } from "ra-core";
import { useInput } from "ra-core";

import { cn } from "@/lib/utils";

import type { ResponsivenessLevel } from "./shadchanUtils";

export interface ResponsivenessInputProps extends Partial<InputProps> {
  source: string;
  label?: string;
}

const CHOICES: { value: ResponsivenessLevel; label: string; token?: string }[] = [
  { value: "high", label: "High", token: "--positive" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low", token: "--attention" },
];

/**
 * A calm segmented chooser for shadchan responsiveness — pills tinted with
 * the same tokens as `ResponsivenessChip` (design-language §5.5 applied to a
 * form control), never a plain unstyled dropdown. Plugs into the react-admin
 * form via `useInput`, mirroring the pattern `RadioButtonGroupInput` uses.
 */
export const ResponsivenessInput = ({
  source,
  label,
  ...rest
}: ResponsivenessInputProps) => {
  const { id, field } = useInput({ source, ...rest });

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <span className="text-sm font-semibold" id={`${id}-label`}>
          {label}
        </span>
      ) : null}
      <div
        id={id}
        role="radiogroup"
        aria-labelledby={label ? `${id}-label` : undefined}
        className="inline-flex w-fit gap-1 rounded-full border border-border bg-secondary p-1"
      >
        {CHOICES.map((choice) => {
          const isSelected = field.value === choice.value;
          const tokenVar = choice.token ? `var(${choice.token})` : undefined;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => field.onChange(choice.value)}
              className={cn(
                "h-11 rounded-full px-4 text-sm font-semibold outline-none",
                "transition-colors duration-[160ms]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isSelected
                  ? "bg-card shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={
                isSelected && tokenVar
                  ? {
                      color: `color-mix(in oklch, ${tokenVar} var(--chip-text-mix), black)`,
                    }
                  : undefined
              }
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

import { useState } from "react";
import type { InputProps } from "ra-core";
import { useInput, useResourceContext, FieldTitle } from "ra-core";
import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@/components/admin/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PasswordToggleButton } from "./PasswordToggleButton";

export type PasswordInputProps = InputProps & {
  inputClassName?: string;
} & Omit<React.ComponentProps<"input">, "type">;

/**
 * ra-core password field (mirrors `admin/text-input.tsx`'s
 * useInput/FormField/FormControl/FormLabel/FormError wiring) with a trailing
 * show/hide toggle. Used by the login form and (via the RHF-flavoured
 * `PasswordToggleButton`) mirrored on the signup form.
 */
export const PasswordInput = (props: PasswordInputProps) => {
  const resource = useResourceContext(props);
  const {
    label,
    source,
    className,
    inputClassName,
    validate: _validateProp,
    format: _formatProp,
    ...rest
  } = props;
  const { id, field, isRequired } = useInput(props);
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <FormField id={id} className={className} name={field.name}>
      {label !== false && (
        <FormLabel>
          <FieldTitle
            label={label}
            source={source}
            resource={resource}
            isRequired={isRequired}
          />
        </FormLabel>
      )}
      <FormControl>
        <div className="relative">
          <Input
            {...rest}
            {...field}
            type={isRevealed ? "text" : "password"}
            className={cn(AUTH_FIELD_CLASSNAME, "pe-11", inputClassName)}
          />
          <PasswordToggleButton
            isRevealed={isRevealed}
            onToggle={() => setIsRevealed((revealed) => !revealed)}
          />
        </div>
      </FormControl>
      <FormError />
    </FormField>
  );
};

import { Eye, EyeOff } from "lucide-react";
import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

export interface PasswordToggleButtonProps {
  /** Whether the password is currently rendered as plain text. */
  isRevealed: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Presentational eye / eye-off icon button for revealing a password field.
 * `type="button"` so it never submits the surrounding form. 44px hit area,
 * positioned by the caller (inline-end of the field, mirrors under RTL).
 * Shared by `PasswordInput` (ra-core auth forms) and `SignupPage` (RHF).
 */
export const PasswordToggleButton = ({
  isRevealed,
  onToggle,
  className,
}: PasswordToggleButtonProps) => {
  const translate = useTranslate();
  const label = translate(
    isRevealed ? "crm.auth.hide_password" : "crm.auth.show_password",
    { _: isRevealed ? "Hide password" : "Show password" },
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={isRevealed}
      className={cn(
        "absolute inset-y-0 end-0 grid w-11 place-items-center text-muted-foreground",
        "transition-colors duration-150 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 rounded-lg",
        className,
      )}
    >
      {isRevealed ? (
        <EyeOff className="size-4" aria-hidden="true" />
      ) : (
        <Eye className="size-4" aria-hidden="true" />
      )}
    </button>
  );
};

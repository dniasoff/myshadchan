import { cn } from "@/lib/utils";

import { isResponsivenessLevel } from "./shadchanUtils";

export interface ResponsivenessChipProps {
  value?: string | null;
  className?: string;
}

const RESPONSIVENESS_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "Highly responsive",
  medium: "Responsive",
  low: "Slow to respond",
};

/**
 * A calm responsiveness cue (design-language §5.5's tinted-pill recipe,
 * applied to a new semantic domain): high = sage `--positive`, low = muted
 * honey `--attention` — never red — medium is a flat neutral chip, no tint.
 * Token-driven like `StateChip`; an unrecognised/missing value renders
 * nothing rather than guessing.
 */
export const ResponsivenessChip = ({
  value,
  className,
}: ResponsivenessChipProps) => {
  if (!isResponsivenessLevel(value)) return null;

  if (value === "medium") {
    return (
      <span
        className={cn(
          "inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-secondary px-2.5",
          "text-xs font-semibold text-muted-foreground ring-1 ring-border",
          className,
        )}
      >
        {RESPONSIVENESS_LABELS.medium}
      </span>
    );
  }

  const tokenVar = value === "high" ? "var(--positive)" : "var(--attention)";

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full ps-2 pe-2.5",
        "text-xs font-semibold",
        className,
      )}
      style={{
        color: `color-mix(in oklch, ${tokenVar} var(--chip-text-mix), black)`,
        backgroundColor: `color-mix(in oklch, ${tokenVar} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${tokenVar} 28%, transparent)`,
      }}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: tokenVar }}
        aria-hidden="true"
      />
      {RESPONSIVENESS_LABELS[value]}
    </span>
  );
};

import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";
import type { CallStatus } from "../types";
import { getCallStatusDescriptor } from "./callStatus";

/**
 * The call-status chip (FR40). Lifted from the design canvas, where it was the
 * best-modelled piece of the reference workspace, and re-parented onto the real
 * entity so every surface renders a status the same way.
 *
 * Token-driven exactly like `StateChip` (design-language §5.5): a tinted pill +
 * solid dot, colour derived from the descriptor's CSS custom-property token via
 * inline style — never a switch of hardcoded Tailwind palette classes.
 */
export const CallStatusChip = ({
  status,
  className,
}: {
  status?: CallStatus | string | null;
  className?: string;
}) => {
  const translate = useTranslate();
  const descriptor = getCallStatusDescriptor(status);
  const tokenVar = `var(${descriptor.token})`;

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full ps-2 pe-2.5",
        "text-xs font-semibold tabular-nums",
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
      {translate(descriptor.labelKey, { _: descriptor.label })}
    </span>
  );
};

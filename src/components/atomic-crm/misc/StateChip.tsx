import { cn } from "@/lib/utils";

import { getPipelineStateDef } from "../shidduchim/pipelineStates";
import type { PipelineState } from "../types";

export interface StateChipProps {
  state: PipelineState;
  className?: string;
}

/**
 * The 7-state colour signature (design-language.md §5.5): a tinted pill +
 * solid dot, driven entirely from the state's CSS custom-property token
 * (`--st-new` … `--st-no`) via inline style — never a switch of hardcoded
 * Tailwind classes, so the chip stays token-driven for every future state.
 */
export const StateChip = ({ state, className }: StateChipProps) => {
  const def = getPipelineStateDef(state);
  if (!def) return null;

  const tokenVar = `var(${def.token})`;

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full ps-2 pe-2.5",
        "text-xs font-semibold tabular-nums",
        className,
      )}
      style={{
        // Darkened via --chip-text-mix (100% = passthrough in dark, where
        // the raw token already clears 3:1 on its own tint) so the text
        // pairing meets the WCAG UI-component floor without touching the
        // shared token — the dot below still renders it at full strength.
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
      {def.label}
    </span>
  );
};

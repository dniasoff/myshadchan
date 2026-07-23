import { ShieldCheck } from "lucide-react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

export interface PrivacyLineProps {
  className?: string;
}

/**
 * The privacy affordance (design-language emotional law #4) — the wedge made
 * visible. A quiet, trust-toned (sage/`--positive`) line, never a badge or an
 * alarm. Reused on the Profile card and the mobile Settings privacy section
 * so the promise reads consistently wherever it appears.
 */
export const PrivacyLine = ({ className }: PrivacyLineProps) => {
  const translate = useTranslate();

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm",
        "bg-[color-mix(in_oklch,var(--positive)_10%,transparent)]",
        "ring-1 ring-[color-mix(in_oklch,var(--positive)_22%,transparent)]",
        className,
      )}
    >
      <span
        className="grid size-6 shrink-0 place-items-center rounded-full
          bg-[color-mix(in_oklch,var(--positive)_28%,transparent)] text-positive-foreground"
        aria-hidden="true"
      >
        <ShieldCheck className="size-3.5" />
      </span>
      <span className="text-foreground">
        {translate("crm.profile.privacy_line", {
          _: "Private to your family · operated at cost, not for profit",
        })}
      </span>
    </div>
  );
};

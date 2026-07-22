import { BellRing } from "lucide-react";

import { Card } from "@/components/ui/card";

/**
 * Honey "to review" section (design-language §5.8): relief, not alarm. The
 * real catch/overdue engine is a later epic (foundation-plan §4) — for the
 * foundation stage this renders the calm empty state, wired so a future feed
 * drops straight in without a layout change.
 */
export const AttentionSection = () => (
  <Card
    className="flex items-start gap-3 border-[color-mix(in_oklch,var(--attention)_35%,transparent)]
      bg-[color-mix(in_oklch,var(--attention)_10%,transparent)] p-5 shadow-sm"
  >
    <span
      className="grid size-9 shrink-0 place-items-center rounded-full
        bg-[color-mix(in_oklch,var(--attention)_28%,transparent)] text-attention-foreground"
      aria-hidden="true"
    >
      <BellRing className="size-4" />
    </span>
    <div>
      <h2 className="font-display text-base font-semibold">
        Needs your attention
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Nothing to review — you're on top of it.
      </p>
    </div>
  </Card>
);

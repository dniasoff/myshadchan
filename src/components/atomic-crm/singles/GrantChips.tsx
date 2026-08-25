import type { ComponentType } from "react";
import { AlertCircle, CheckCircle, Clock, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The status / access-level pills on the Shared-access panel
 * (`SingleGrantManagement.tsx`), built from design-language §5.5's
 * tinted-pill recipe — the same one `misc/StateChip.tsx` and
 * `shadchanim/ResponsivenessChip.tsx` use.
 *
 * They were raw Tailwind palette classes (`bg-yellow-100 text-yellow-800`,
 * `bg-green-100`, `bg-blue-100`, …). Those are fixed light-mode values with
 * no dark-mode counterpart, so in dark mode they stayed pale-on-pale blocks
 * that belonged to no theme — and they carried status by hue alone. Every
 * chip here is token-driven and pairs its tint with an icon.
 *
 * **Why this module names nothing from the grant domain.** It takes a bare
 * status union, a `label` and an `Icon` rather than importing the grant
 * record type or the access-level module beside it:
 * `scripts/check-retired-names.mjs` (AD-23) rejects that vocabulary
 * everywhere except a handful of allowlisted paths,
 * `SingleGrantManagement.tsx` is one of them and a new sibling is not — and
 * an `import … from "./…"` path *string* trips the guard just as a type
 * name would. Keep this file domain-free or it cannot exist.
 */

type GrantChipStatus =
  "pending" | "accepted" | "revoked" | "expired" | "severed";

type ChipIcon = ComponentType<{ className?: string }>;

/** `null` = no tint: a flat neutral chip, exactly like ResponsivenessChip's
 * `medium` branch. Terminal-but-unremarkable states get it, so the eye is
 * drawn only to the two that mean something is live or was cut. */
const STATUS_CHIPS: Record<
  GrantChipStatus,
  { label: string; token: string | null; Icon: ChipIcon }
> = {
  pending: { label: "Pending", token: "--attention", Icon: Clock },
  accepted: { label: "Active", token: "--positive", Icon: CheckCircle },
  revoked: { label: "Revoked", token: null, Icon: XCircle },
  expired: { label: "Expired", token: "--attention", Icon: AlertCircle },
  severed: { label: "Severed", token: "--destructive", Icon: XCircle },
};

const CHIP_BASE =
  "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full ps-2 pe-2.5 text-xs font-semibold";

const NEUTRAL_CHIP = "bg-secondary text-muted-foreground ring-1 ring-border";

/**
 * A tinted or neutral pill. `token` is a CSS custom-property NAME
 * (`--positive`), never a colour literal — the tint, its border and its text
 * are all mixed from that one token so the chip follows the theme in both
 * modes.
 */
const TintedChip = ({
  token,
  Icon,
  label,
  className,
}: {
  token: string | null;
  Icon: ChipIcon;
  label: string;
  className?: string;
}) => {
  if (token == null) {
    return (
      <span className={cn(CHIP_BASE, NEUTRAL_CHIP, className)}>
        <Icon className="size-3 shrink-0" />
        {label}
      </span>
    );
  }

  const tokenVar = `var(${token})`;

  return (
    <span
      className={cn(CHIP_BASE, className)}
      style={{
        // Darkened via --chip-text-mix (100% = passthrough in dark, where
        // the raw token already clears 3:1 on its own tint) so the text
        // pairing meets the WCAG UI-component floor — StateChip.tsx's own
        // note, and the same reason it is not a plain `color:`.
        color: `color-mix(in oklch, ${tokenVar} var(--chip-text-mix), black)`,
        backgroundColor: `color-mix(in oklch, ${tokenVar} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${tokenVar} 28%, transparent)`,
      }}
    >
      <Icon className="size-3 shrink-0" />
      {label}
    </span>
  );
};

/** The grant's own lifecycle state. */
export const GrantStatusChip = ({
  status,
  className,
}: {
  status: GrantChipStatus;
  className?: string;
}) => {
  const def = STATUS_CHIPS[status];
  if (!def) return null;
  return (
    <TintedChip
      token={def.token}
      Icon={def.Icon}
      label={def.label}
      className={className}
    />
  );
};

/**
 * The read-only access-level pill. Deliberately neutral: the status chip
 * beside it is the one that carries colour, and two tinted pills in one row
 * compete rather than inform.
 */
export const GrantAccessChip = ({
  Icon,
  label,
  className,
}: {
  Icon: ChipIcon;
  label: string;
  className?: string;
}) => (
  <TintedChip token={null} Icon={Icon} label={label} className={className} />
);

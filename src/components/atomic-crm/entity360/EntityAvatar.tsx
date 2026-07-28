import { cn } from "@/lib/utils";

import { getAvatarIndex, getMonogram } from "./avatar";

export interface EntityAvatarProps {
  /** Palette seed — fed to `getAvatarIndex`. Every call site today passes
   * `name ?? String(id)`, distinct from `monogramSource` because a record
   * with no name still needs a stable, per-record palette colour. */
  seed?: string | null;
  /** Fed to `getMonogram`. Distinct from `seed`: every call site passes the
   * record's display name here, unconditionally (no id fallback), because a
   * missing name should render "?", not a monogram of the id. */
  monogramSource?: string | null;
  /**
   * Sets size, radius and text size. The component's own base classes
   * (`grid shrink-0 place-items-center font-bold`) carry none of those, so
   * `className` is appended without a `tailwind-merge` conflict. When
   * omitted, a fallback className is used instead — not merged with the
   * base classes.
   */
  className?: string;
}

const DEFAULT_CLASS_NAME = "h-14 w-14 rounded-2xl text-lg";

/**
 * The cross-entity monogram avatar chip (Epic 3 API contract §1 rule 6):
 * a deterministic `--avatar-{0..9}` background behind a two-letter monogram.
 * Decorative in every caller today — the name it abbreviates always renders
 * as an adjacent heading — so the chip is always `aria-hidden`.
 */
export const EntityAvatar = ({
  seed,
  monogramSource,
  className,
}: EntityAvatarProps) => (
  <div
    className={cn(
      "grid shrink-0 place-items-center font-bold",
      className ?? DEFAULT_CLASS_NAME,
    )}
    style={{
      backgroundColor: `var(--avatar-${getAvatarIndex(seed)})`,
      color: "var(--avatar-ink)",
    }}
    aria-hidden="true"
  >
    {getMonogram(monogramSource)}
  </div>
);

import type { ReactNode } from "react";

export interface EntityListHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
}

/**
 * The eyebrow/title/subtitle block every roster-style list shares (AC 1) —
 * previously duplicated, with small variations, inside `SingleList.tsx`'s
 * `SingleListHeader` and `ShadchanList.tsx`'s `ShadchanDirectory`. `eyebrow`
 * and `subtitle` arrive pre-translated: each call site keeps its own
 * `crm.<entity>.list.*` keys and `_:` fallback via `useTranslate` (AD-18) —
 * this component only lays them out.
 */
export const EntityListHeader = ({
  eyebrow,
  title,
  subtitle,
}: EntityListHeaderProps) => (
  <div className="mb-6">
    {eyebrow ? (
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {eyebrow}
      </p>
    ) : null}
    <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
    {subtitle ? (
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    ) : null}
  </div>
);

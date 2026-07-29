import type { ReactNode } from "react";
import { Link } from "react-router";

import { FilterButton } from "@/components/admin/filter-form";
import { SortButton } from "@/components/admin/sort-button";

import { TopToolbar } from "../layout/TopToolbar";

/** Lifted verbatim from today's `SingleList.tsx`'s `SingleListHeader` /
 * `ShadchanList.tsx`'s `AddShadchanButton` (AC 7 — one visual, not one per
 * entity, replaces both). */
const CREATE_CTA_CLASSNAME = `inline-flex h-11 items-center gap-2 rounded-xl px-4
  font-semibold text-primary-foreground
  bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
  shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
  transition-[transform,box-shadow] duration-[160ms] ease-(--ease-spring)
  hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
  active:scale-[0.97]
  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
  focus-visible:ring-offset-background outline-none`;

export interface EntityListToolbarProps {
  sortFields?: string[];
  createTo?: string;
  createLabel?: string;
  /**
   * Explicit, empty in this story — Story 4.2 fills it with the List/Cards
   * view-mode toggle. Do not add a toggle here (see 4.1 Dev Notes, "What
   * 4.1 deliberately does not build").
   */
  viewToggle?: ReactNode;
}

/**
 * The `<List actions>` slot every retrofitted list shares (AC 1): a
 * filter-toggle button (self-hiding via `FilterButton`'s own guard when
 * there is nothing beyond the always-on search box to toggle), an optional
 * sort button, the reserved view-toggle slot, and the single gradient
 * create CTA — one visual, not one per entity (AC 7).
 */
export const EntityListToolbar = ({
  sortFields,
  createTo,
  createLabel,
  viewToggle,
}: EntityListToolbarProps) => (
  <TopToolbar>
    <FilterButton />
    {sortFields && sortFields.length > 0 ? (
      <SortButton fields={sortFields} />
    ) : null}
    {viewToggle}
    {createTo ? (
      <Link to={createTo} className={CREATE_CTA_CLASSNAME}>
        {createLabel}
      </Link>
    ) : null}
  </TopToolbar>
);

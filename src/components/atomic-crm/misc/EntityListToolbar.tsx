import type { ReactElement, ReactNode } from "react";
import { Plus } from "lucide-react";
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
   * Task 3, verbatim: render `<FilterButton/>` "only when `extraFilters` is
   * non-empty". Review fix (F8): `FilterButton` does NOT self-hide for this
   * case — its own guard only suppresses when there are zero togglable
   * filters AND zero saved queries AND no active filter value at all, so
   * the moment the always-on search box gets a value (`filterValues.q` is
   * set), `hasFilterValues` flips true and the button un-hides mid-typing,
   * opening onto a dropdown with nothing in it but "Save current
   * query…"/"Remove all filters". Neither retrofitted list passes
   * `extraFilters` today, so this prop being unset renders no button at
   * all — the literal Task 3 instruction, not `FilterButton`'s own guard.
   */
  extraFilters?: ReactElement[];
  /**
   * Story 4.2, AC 2: `EntityList` fills this with a single
   * `EntityListViewToggle` instance — one control, one place, immediately
   * left of the create link — never a second, per-entity toggle
   * implementation (4.1 Dev Notes, "What 4.1 deliberately does not build").
   */
  viewToggle?: ReactNode;
}

/**
 * The `<List actions>` slot every retrofitted list shares (AC 1): a
 * filter-toggle button (rendered only when there is an `extraFilters` entry
 * beyond the always-on search box to toggle — Task 3, F8), an optional sort
 * button, the reserved view-toggle slot, and the single gradient create
 * CTA — one visual, not one per entity (AC 7).
 */
export const EntityListToolbar = ({
  sortFields,
  createTo,
  createLabel,
  extraFilters,
  viewToggle,
}: EntityListToolbarProps) => (
  // Review fix (F1): `TopToolbar`'s own default row is `whitespace-nowrap`
  // with no `flex-wrap` — fine for every other caller (one or two buttons),
  // but this toolbar can now carry FilterButton + SortButton +
  // EntityListViewToggle (two buttons) + the create link at once, and their
  // combined min-content width exceeds the available row width in the
  // 768-809px tablet band (measured: 809/810px document scrollWidth against
  // a 768px viewport, both on /shadchanim and /singles). A flex row with no
  // wrap cannot shrink a single control below its own content size, so the
  // row forced the whole page to scroll horizontally instead of overflowing
  // onto a second line. `flex-wrap` (this call site only, via `className` —
  // `TopToolbar`'s own default stays `nowrap` for its other callers) lets
  // the controls that do not fit drop to a second line, right-aligned, with
  // no page-level horizontal scroll at any width (carried by
  // `e2e/entity-list-view-toggle.spec.ts`'s "no horizontal scroll" checks).
  <TopToolbar className="flex-wrap justify-end gap-y-2">
    {extraFilters && extraFilters.length > 0 ? <FilterButton /> : null}
    {sortFields && sortFields.length > 0 ? (
      <SortButton fields={sortFields} />
    ) : null}
    {viewToggle}
    {createTo ? (
      <Link to={createTo} className={CREATE_CTA_CLASSNAME}>
        <Plus className="size-4" aria-hidden="true" />
        {createLabel}
      </Link>
    ) : null}
  </TopToolbar>
);

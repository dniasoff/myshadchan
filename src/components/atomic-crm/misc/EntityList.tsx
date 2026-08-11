import type { ReactElement, ReactNode } from "react";
import type { SortPayload } from "ra-core";
import { useTranslate } from "ra-core";

import { List } from "@/components/admin/list";
import { ListPagination } from "@/components/admin/list-pagination";
import { SearchInput } from "@/components/admin/search-input";

import { getEntityDescriptor } from "../entity360/registry";
import { EntityListHeader } from "./EntityListHeader";
import { EntityListToolbar } from "./EntityListToolbar";
import { EntityListView } from "./EntityListView";
import type { EntityListViewProps } from "./EntityListView";
import { EntityListViewToggle } from "./EntityListViewToggle";
import { useEntityListViewMode } from "./useEntityListViewMode";
import type { EntityListViewMode } from "./useEntityListViewMode";

export interface EntityListProps extends Pick<
  EntityListViewProps,
  | "resource"
  | "skeleton"
  | "emptyState"
  | "noMatchesMessage"
  | "renderList"
  | "renderCards"
> {
  eyebrow?: string;
  subtitle?: string;
  createTo?: string;
  createLabel?: string;
  searchPlaceholder?: string;
  extraFilters?: ReactElement[];
  sortFields?: string[];
  sort?: SortPayload;
  perPage?: number;
  filterDefaultValues?: Record<string, any>;
  /**
   * Passthrough to `<List pagination>`. Left `undefined` (the default),
   * `EntityList` paginates with the standard `<ListPagination/>`; pass
   * `null` to disable it entirely — the shadchan book has never paged
   * (Task 6) and `<List>` itself only substitutes its own default when this
   * prop is `undefined`, not when it is `null`.
   */
  pagination?: ReactNode | null;
  /**
   * The mode `useEntityListViewMode` (Story 4.2, AC 3) falls back to before
   * any choice has ever been persisted for this resource. Both retrofitted
   * lists keep `"cards"` — their current, only, deliberately-designed
   * first-visit look (Dev Notes, "Why the default is Cards on both lists").
   */
  defaultViewMode: EntityListViewMode;
}

/**
 * AD-24's one component for roster-style entity list chrome (AC 1): search
 * box, filter toggle, sort control, pagination, the persisted List/Cards
 * toggle (Story 4.2, AC 2/3), and the four-state
 * loading/empty/error/no-matches rendering (delegated to `EntityListView`).
 * An entity contributes its own per-item renderers (`renderList`/
 * `renderCards`) and its own skeleton/empty-state copy — never a second
 * chrome implementation.
 */
export const EntityList = ({
  resource,
  eyebrow,
  subtitle,
  createTo,
  createLabel,
  searchPlaceholder,
  extraFilters,
  sortFields,
  sort,
  perPage,
  filterDefaultValues,
  pagination,
  skeleton,
  emptyState,
  noMatchesMessage,
  renderList,
  renderCards,
  defaultViewMode,
}: EntityListProps) => {
  const translate = useTranslate();
  // Guarded accessor (Epic 3 API contract §4 rule 3): EntityList is generic
  // over resources, and three of the seven in root/routeManifest.ts
  // deliberately have no descriptor (ad24Conformance.ts's
  // DESCRIPTORLESS_RESOURCES) — requireEntityDescriptor would throw for
  // `tasks`/`inbox_items`/`members`. Never dereference the guarded form
  // (.claude/rules/coding-style.md#Error-handling).
  const descriptor = getEntityDescriptor(resource);
  const heading = translate(`resources.${resource}.name`, {
    smart_count: 2,
    _: descriptor?.label ?? resource,
  });
  const [viewMode, setViewMode] = useEntityListViewMode(
    resource,
    defaultViewMode,
  );

  return (
    <>
      {/* Review fix (F3): rendered ahead of `<List>` rather than as its
       * child. `@/components/admin/list`'s `ListView` has a fixed internal
       * order — breadcrumb, then a title/actions row, then `<FilterForm/>`
       * (the always-on search box), THEN `children` — so a heading passed
       * as a child renders below the search box and the create CTA. A real
       * render confirmed the DOM order: empty title row → create link →
       * search input → this heading → cards, i.e. the page heading no
       * longer led the page. Reusing `<List>`'s own slots is still the
       * point (AD-10/AD-24 — no bespoke chrome), so the fix is ordering,
       * not reimplementation: the heading is the one piece of chrome that
       * has to visually lead, so it moves outside the composition whose
       * internal order this component does not control. */}
      <EntityListHeader eyebrow={eyebrow} title={heading} subtitle={subtitle} />
      <List
        resource={resource}
        title={false}
        perPage={perPage ?? 100}
        sort={sort}
        filterDefaultValues={filterDefaultValues}
        pagination={pagination === undefined ? <ListPagination /> : pagination}
        filters={[
          <SearchInput
            source="q"
            alwaysOn
            key="q"
            placeholder={searchPlaceholder}
          />,
          ...(extraFilters ?? []),
        ]}
        actions={
          <EntityListToolbar
            sortFields={sortFields}
            createTo={createTo}
            createLabel={createLabel}
            extraFilters={extraFilters}
            viewToggle={
              <EntityListViewToggle mode={viewMode} onChange={setViewMode} />
            }
          />
        }
      >
        <EntityListView
          resource={resource}
          skeleton={skeleton}
          emptyState={emptyState}
          noMatchesMessage={noMatchesMessage}
          renderList={renderList}
          renderCards={renderCards}
          viewMode={viewMode}
          filterDefaultValues={filterDefaultValues}
        />
      </List>
    </>
  );
};

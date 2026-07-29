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

export interface EntityListProps extends Pick<
  EntityListViewProps,
  "resource" | "skeleton" | "emptyState" | "noMatchesMessage" | "renderItems"
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
  /**
   * Passthrough to `<List pagination>`. Left `undefined` (the default),
   * `EntityList` paginates with the standard `<ListPagination/>`; pass
   * `null` to disable it entirely — the shadchan book has never paged
   * (Task 6) and `<List>` itself only substitutes its own default when this
   * prop is `undefined`, not when it is `null`.
   */
  pagination?: ReactNode | null;
}

/**
 * AD-24's one component for roster-style entity list chrome (AC 1): search
 * box, filter toggle, sort control, pagination, and the four-state
 * loading/empty/error/no-matches rendering (delegated to `EntityListView`).
 * An entity contributes its own per-item renderer (`renderItems`) and its
 * own skeleton/empty-state copy — never a second chrome implementation.
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
  pagination,
  skeleton,
  emptyState,
  noMatchesMessage,
  renderItems,
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

  return (
    <List
      resource={resource}
      title={false}
      perPage={perPage ?? 100}
      sort={sort}
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
        />
      }
    >
      <EntityListHeader eyebrow={eyebrow} title={heading} subtitle={subtitle} />
      <EntityListView
        resource={resource}
        skeleton={skeleton}
        emptyState={emptyState}
        noMatchesMessage={noMatchesMessage}
        renderItems={renderItems}
      />
    </List>
  );
};

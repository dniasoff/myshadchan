import type { Identifier, RaRecord } from "ra-core";
import { useGetList, useTranslate } from "ra-core";
import { useMemo } from "react";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import type { Single, SingleSummary } from "../types";
import { SingleCardGrid, SingleCardGridSkeleton } from "./SingleCardGrid";
import { SingleRow } from "./SingleRow";

/**
 * `EntityList`'s `renderList` for the singles roster (Story 4.2, Task 4):
 * the row-based counterpart to `SingleCardGrid`. Mirrors that component's
 * own self-contained `singles_summary` enrichment read rather than sharing
 * state through props — `renderList`/`renderCards` are never both active at
 * once (`EntityListView` renders exactly one per `viewMode`), so the two
 * reads are never in flight together.
 */
const SingleRowList = ({ data }: { data: RaRecord[] }) => {
  const singles = data as Single[];
  const { data: summaries } = useGetList<SingleSummary>("singles_summary", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
  });
  const openCountById = useMemo(() => {
    const map = new Map<Identifier, number>();
    (summaries ?? []).forEach((summary) =>
      map.set(summary.id, summary.open_shidduchim),
    );
    return map;
  }, [summaries]);

  return (
    <div className="flex flex-col gap-2">
      {singles.map((single, index) => (
        <SingleRow
          key={single.id}
          single={single}
          index={index}
          openCount={openCountById.get(single.id)}
        />
      ))}
    </div>
  );
};

/**
 * The singles roster (screen 32): Cards by default (design-language §5.1),
 * List as the alternative Story 4.2 adds (AC 1) — the same identity fields
 * either way, never a second query per row (E6). All list chrome (search,
 * heading, empty/error/loading states, pagination, the List/Cards toggle)
 * comes from `EntityList` (Story 4.1/4.2, AD-24); this file supplies only
 * the per-single renderers and this list's own copy.
 */
export const SingleList = () => {
  const translate = useTranslate();

  return (
    <EntityList
      resource="singles"
      eyebrow={translate("crm.singles.list.eyebrow", { _: "Family roster" })}
      subtitle={translate("crm.singles.list.subtitle", {
        _: "Every single you are redting for, each with their own pipeline.",
      })}
      createTo={buildNewPath("singles")}
      createLabel={translate("crm.singles.list.createLabel", {
        _: "Add a single",
      })}
      searchPlaceholder={translate("crm.singles.list.searchPlaceholder", {
        _: "Search by name",
      })}
      perPage={100}
      // Review fix (F7): the pre-story `SingleList` explicitly disabled
      // pagination (`pagination={null}`) for this roster, which has never
      // paged — the retrofit silently dropped that, and `EntityList`
      // substitutes its own `<ListPagination/>` for any `pagination` value
      // left `undefined`. Preserve the original, deliberate behaviour.
      pagination={null}
      sort={{ field: "first_name_en", order: "ASC" }}
      // Review fix (F4): AC-10 requires sort to be provable through the
      // URL; with no `sortFields` on either retrofitted list,
      // `EntityListToolbar`'s `SortButton` never rendered and the sort
      // half of AC-5/AC-10 had no reachable UI anywhere in the app.
      sortFields={["first_name_en", "last_name_en"]}
      skeleton={<SingleCardGridSkeleton />}
      emptyState={{
        title: translate("crm.singles.list.emptyTitle", {
          _: "Add your first single",
        }),
        description: translate("crm.singles.list.emptyDescription", {
          _: "A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions.",
        }),
        actionLabel: translate("crm.singles.list.createLabel", {
          _: "Add a single",
        }),
        actionTo: buildNewPath("singles"),
      }}
      noMatchesMessage={translate("crm.singles.list.noMatches", {
        _: "No singles match this search.",
      })}
      // Story 4.2, AC 1: this roster's current, only, deliberately-designed
      // first-visit look — a small family roster reads better as cards than
      // as a dense table (Dev Notes).
      defaultViewMode="cards"
      renderCards={(data) => <SingleCardGrid data={data} />}
      renderList={(data) => <SingleRowList data={data} />}
    />
  );
};

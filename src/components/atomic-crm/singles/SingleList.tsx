import { useTranslate } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import { SingleCardGrid, SingleCardGridSkeleton } from "./SingleCardGrid";

/**
 * The singles roster (screen 32): a card grid, not a table — the family's
 * singles are few, and each deserves a humane presence, not a datagrid row.
 * All list chrome (search, heading, empty/error/loading states, pagination)
 * comes from `EntityList` (Story 4.1, AD-24); this file supplies only the
 * per-single card grid (`SingleCardGrid.tsx`, with its `singles_summary`
 * pipeline-count enrichment) and this list's own copy.
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
      sort={{ field: "first_name_en", order: "ASC" }}
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
      renderItems={(data) => <SingleCardGrid data={data} />}
    />
  );
};

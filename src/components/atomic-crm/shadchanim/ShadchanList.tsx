import type { RaRecord } from "ra-core";
import { useGetList, useTranslate } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import type { Shadchan, ShidduchSummary } from "../types";
import { ShadchanCard } from "./ShadchanCard";
import { countSuggestionsByShadchan } from "./shadchanUtils";

/**
 * `EntityList`'s `renderItems` for the shadchan book (§5's screen 19). Owns
 * the per-shadchan suggestion-count enrichment: one account-wide
 * `shidduchim` query, grouped client-side (no `shadchanim`-level aggregate
 * view exists yet, and a per-card query would be an N+1 — screens-plan
 * Lane 4 risk note). Unrelated to list chrome (AC 1) — kept here, not in
 * `EntityList`. Not extracted to its own file: unlike `singles`, this
 * story's declared path set keeps the shadchan grid inside `ShadchanList.tsx`.
 */
const ShadchanCardGrid = ({ data }: { data: RaRecord[] }) => {
  const shadchanim = data as Shadchan[];
  const { data: shidduchim } = useGetList<ShidduchSummary>("shidduchim", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
  });
  const counts = countSuggestionsByShadchan(shidduchim ?? []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shadchanim.map((shadchan, index) => (
        <ShadchanCard
          key={shadchan.id}
          shadchan={shadchan}
          suggestionCount={counts.get(shadchan.id) ?? 0}
          index={index}
        />
      ))}
    </div>
  );
};

/** Today's `ShadchanGridSkeleton` markup, renamed (AC 7 deletes that exact
 * identifier — see `LSP workspaceSymbol`) since it now lives alongside
 * `SingleCardGridSkeleton` under the same naming convention. */
const ShadchanCardGridSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div
        key={index}
        className="h-[126px] animate-pulse rounded-2xl bg-muted"
      />
    ))}
  </div>
);

/**
 * The shadchan book (§5's screen 19): the account-wide directory of
 * matchmakers, one calm card per shadchan. All list chrome (search,
 * heading, empty/error/loading states) comes from `EntityList` (Story 4.1,
 * AD-24); this file supplies only the per-shadchan card grid above, its
 * `shidduchim`-count enrichment, and this list's own copy. `pagination={null}`
 * preserves today's deliberate no-paging behaviour for this small book.
 */
export const ShadchanList = () => {
  const translate = useTranslate();

  return (
    <EntityList
      resource="shadchanim"
      eyebrow={translate("crm.shadchanim.list.eyebrow", {
        _: "Matchmaker book",
      })}
      subtitle={translate("crm.shadchanim.list.subtitle", {
        _: "Every matchmaker your family has worked with, in one calm book.",
      })}
      createTo={buildNewPath("shadchanim")}
      createLabel={translate("crm.shadchanim.list.createLabel", {
        _: "Add a shadchan",
      })}
      searchPlaceholder={translate("crm.shadchanim.list.searchPlaceholder", {
        _: "Search by name",
      })}
      perPage={200}
      pagination={null}
      sort={{ field: "name", order: "ASC" }}
      skeleton={<ShadchanCardGridSkeleton />}
      emptyState={{
        title: translate("crm.shadchanim.list.emptyTitle", {
          _: "Add your first shadchan",
        }),
        description: translate("crm.shadchanim.list.emptyDescription", {
          _: "Every redt comes from somewhere — keep a book of the matchmakers your family works with.",
        }),
        actionLabel: translate("crm.shadchanim.list.createLabel", {
          _: "Add a shadchan",
        }),
        actionTo: buildNewPath("shadchanim"),
      }}
      noMatchesMessage={translate("crm.shadchanim.list.noMatches", {
        _: "No shadchanim match this search.",
      })}
      renderItems={(data) => <ShadchanCardGrid data={data} />}
    />
  );
};

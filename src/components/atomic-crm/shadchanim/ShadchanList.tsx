import type { RaRecord } from "ra-core";
import { useGetList, useTranslate } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import type { Shadchan, ShidduchSummary } from "../types";
import { ShadchanCardGrid, ShadchanCardGridSkeleton } from "./ShadchanCardGrid";
import { ShadchanRow } from "./ShadchanRow";
import { countSuggestionsByShadchan } from "./shadchanUtils";

/**
 * `EntityList`'s `renderList` for the shadchan book (Story 4.2, Task 4): the
 * row-based counterpart to `ShadchanCardGrid`. Mirrors that component's own
 * self-contained `shidduchim` fetch and pending-gate (review fix F5) rather
 * than sharing state through props — `renderList`/`renderCards` are never
 * both active at once (`EntityListView` renders exactly one per
 * `viewMode`), so the two queries are never in flight together.
 */
const ShadchanRowList = ({ data }: { data: RaRecord[] }) => {
  const shadchanim = data as Shadchan[];
  const { data: shidduchim, isPending: shidduchimPending } =
    useGetList<ShidduchSummary>("shidduchim", {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "id", order: "ASC" },
    });

  if (shidduchimPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-[63px] animate-pulse rounded-xl bg-muted"
          />
        ))}
      </div>
    );
  }

  const counts = countSuggestionsByShadchan(shidduchim ?? []);

  return (
    <div className="flex flex-col gap-2">
      {shadchanim.map((shadchan, index) => (
        <ShadchanRow
          key={shadchan.id}
          shadchan={shadchan}
          suggestionCount={counts.get(shadchan.id) ?? 0}
          index={index}
        />
      ))}
    </div>
  );
};

/**
 * The shadchan book (§5's screen 19): Cards by default (design-language
 * §5.1), List as the alternative Story 4.2 adds (AC 1). All list chrome
 * (search, heading, empty/error/loading states, the List/Cards toggle)
 * comes from `EntityList` (Story 4.1/4.2, AD-24); this file supplies only
 * this list's own copy — the per-shadchan renderers and their
 * `shidduchim`-count enrichment live in `ShadchanCardGrid.tsx` / the
 * `ShadchanRowList` above (review fix F6, mirroring `singles/SingleList.tsx`).
 * `pagination={null}` preserves today's deliberate no-paging behaviour for
 * this small book.
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
      // Review fix (F4): see SingleList.tsx's identical note — AC-10's sort
      // clause had no reachable UI on either retrofitted list.
      sortFields={["name", "location"]}
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
        // Review fix (F9): the pre-story `ShadchanDirectory`'s EmptyState
        // carried `className="py-14"`; the retrofit dropped it.
        className: "py-14",
      }}
      noMatchesMessage={translate("crm.shadchanim.list.noMatches", {
        _: "No shadchanim match this search.",
      })}
      // Story 4.2, AC 1: this book's current, only, deliberately-designed
      // first-visit look (Dev Notes).
      defaultViewMode="cards"
      renderCards={(data) => <ShadchanCardGrid data={data} />}
      renderList={(data) => <ShadchanRowList data={data} />}
    />
  );
};

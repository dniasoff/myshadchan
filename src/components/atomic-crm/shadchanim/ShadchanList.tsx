import { useTranslate } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import { ShadchanCardGrid, ShadchanCardGridSkeleton } from "./ShadchanCardGrid";

/**
 * The shadchan book (§5's screen 19): the account-wide directory of
 * matchmakers, one calm card per shadchan. All list chrome (search,
 * heading, empty/error/loading states) comes from `EntityList` (Story 4.1,
 * AD-24); this file supplies only this list's own copy — the per-shadchan
 * card grid and its `shidduchim`-count enrichment live in
 * `ShadchanCardGrid.tsx` (review fix F6, mirroring `singles/SingleCardGrid.tsx`).
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
      renderItems={(data) => <ShadchanCardGrid data={data} />}
    />
  );
};

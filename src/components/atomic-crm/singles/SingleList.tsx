import type { Identifier, RaRecord } from "ra-core";
import { useGetList, useTranslate } from "ra-core";
import { useMemo } from "react";

import { buildNewPath } from "../entity360/entityPaths";
import { EntityList } from "../misc/EntityList";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import { useMyPersonas } from "../root/useMyPersonas";
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
 *
 * Story 6.5 (AC 4): the subtitle and empty-state description are written
 * from a parent's point of view ("the person you are redting for") — false
 * for a self-manager, whose own pipeline is their own. Branched on the
 * PERSONAS held (`useMyPersonas()`), never on `useViewerRole()` alone: a
 * self-manager who ALSO holds the `parent` persona legitimately manages
 * other singles too and should see the parent-shaped copy (Dev Notes,
 * "Why 'self-seeker is not a separate account type' matters here"). A
 * `helper`/`shadchan` — or a still-loading personas read — holds neither
 * persona and falls through to the existing, unchanged copy.
 *
 * Review fix: `useMyPersonas()` is user-GLOBAL (one row per persona the
 * login holds across EVERY account it belongs to), but this list is scoped
 * to whichever account is currently active. Reading it unfiltered produced
 * two wrong-copy cases: a self-manager who also `helper`s in an unrelated
 * household saw the self-managed copy while browsing that OTHER household's
 * (not their own) roster, and a `parent_admin` of one household who also
 * self-manages another saw the parent copy while looking at the household
 * they self-manage. Filtering `personas` to `pickActiveContext(contexts)
 * .account_id` (the same "active" `useViewerRole()` reads, via the same
 * `useMyContexts()` cache — no second RPC call) makes both branches answer
 * for the account actually on screen.
 */
export const SingleList = () => {
  const translate = useTranslate();
  const { data: personas } = useMyPersonas();
  const { data: contexts } = useMyContexts();
  const activeAccountId = pickActiveContext(contexts)?.account_id;
  const activePersonas = personas?.filter(
    (p) => p.account_id === activeAccountId,
  );
  const holdsParentPersona =
    activePersonas?.some((p) => p.persona === "parent") ?? false;
  // Also true for an ordinary `single`-role viewer (my_personas()'s third
  // union matches `role = 'single'` too, not only an owning role with a
  // linked singles row) — the name is "the pipeline shown is my own", not
  // "I hold the self_manager role specifically"; both cases read correctly
  // as the self-referential copy either way, so no narrower check is needed.
  const isSelfManagedOnly =
    !holdsParentPersona &&
    (activePersonas?.some((p) => p.persona === "single") ?? false);

  return (
    <EntityList
      resource="singles"
      eyebrow={translate("crm.singles.list.eyebrow", { _: "Family roster" })}
      subtitle={
        isSelfManagedOnly
          ? translate("crm.singles.list.subtitleSelfManaged", {
              _: "Your own shidduchim pipeline, all in one place.",
            })
          : translate("crm.singles.list.subtitle", {
              _: "Every single you are redting for, each with their own pipeline.",
            })
      }
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
        description: isSelfManagedOnly
          ? translate("crm.singles.list.emptyDescriptionSelfManaged", {
              _: "This is where your own shidduchim pipeline will live. Add your record to start tracking suggestions.",
            })
          : translate("crm.singles.list.emptyDescription", {
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

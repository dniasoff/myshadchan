import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext } from "ra-core";
import { matchPath, useLocation } from "react-router";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import { TopToolbar } from "../layout/TopToolbar";
import { EmptyState } from "../misc/EmptyState";
import type { Single } from "../types";
import { ShidduchCreate } from "./ShidduchCreate";
import { ShidduchShow } from "./ShidduchShow";
import { ShidduchimViewSwitch } from "./ShidduchimViewSwitch";

const singleLabel = (single: Single) => single.first_name_en ?? `#${single.id}`;

/**
 * `single_id` lives in the URL's `filter` param once `<List>` mounts (Task
 * 2) — but the create page (`matchNew` below) is returned ABOVE `<List>`, so
 * there is no `ListContext` there to read it from. Parsing the raw query
 * string directly is what keeps "Add a suggestion" landing on whichever
 * single the pills currently have selected, across that one navigation that
 * doesn't mount `<List>`. Falls back to the first single on any parse
 * failure or a fresh visit with no `filter` param yet.
 */
const parseSingleIdFromSearch = (search: string): Identifier | undefined => {
  try {
    const raw = new URLSearchParams(search).get("filter");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.single_id;
    return typeof value === "string" || typeof value === "number"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

const ShidduchimList = () => {
  const location = useLocation();
  const matchNew = matchPath(buildNewPath("shidduchim"), location.pathname);
  const { identity } = useGetIdentity();
  const { data: singles, isPending: singlesPending } = useGetList<Single>(
    "singles",
    {
      // 2.5 AC-8: an archived single is not a selectable "current" single.
      filter: { "status@neq": "archived" },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "first_name_en", order: "ASC" },
    },
  );

  if (!identity || singlesPending) return null;
  if (!singles || singles.length === 0) return <ShidduchimNoSingles />;

  // The create page is returned above `<List>`, not inside the body below
  // (Story 3.13 Dev Notes): a page needs neither the board's own `shidduchim`
  // query nor its `isPending` gate, and mounting `<List>` underneath it would
  // keep the pipeline alive beneath the page — the modal shape with the scrim
  // removed, not a page.
  if (matchNew) {
    const singleId = parseSingleIdFromSearch(location.search) ?? singles[0].id;
    return <ShidduchCreate singleId={singleId} />;
  }

  return (
    <List
      title={false}
      perPage={200}
      // Task 2 (AC 4): a `filterDefaultValues`, not a hard `filter` computed
      // from local state — ra-core's `getQuery()` falls back to this only
      // when neither the URL nor stored list params already supply a value,
      // so it is resolved exactly once, synchronously, the same moment the
      // pre-story `singleId ?? singles[0].id` was. The `if (!singles...)`
      // guard above already guarantees `singles` is loaded here.
      filterDefaultValues={{ single_id: singles[0].id }}
      filters={[<SearchInput source="q" alwaysOn key="q" />]}
      sort={{ field: "index", order: "ASC" }}
      pagination={null}
      actions={<ShidduchimActions />}
    >
      <ShidduchimBody singleList={singles} />
    </List>
  );
};

const ShidduchimActions = () => (
  // AC-2 forbids a second useIsMobile() call under shidduchim/ — the ONE
  // call lives in ShidduchimViewSwitch. Hiding this toolbar below the `md`
  // breakpoint (768px — the exact breakpoint useIsMobile() itself uses) is
  // therefore done in CSS, not a JS conditional; it also avoids the
  // mount-then-hide flash a useState-backed boolean would cause. The mobile
  // FAB (layout/MobileNavigation.tsx) already carries create.
  // Task 8: "add-suggestion" now anchors the pipeline's own first "＋ Add
  // here" link (ShidduchColumn / PipelineSection) — an anchor that exists on
  // every width — not this desktop-only toolbar button.
  <TopToolbar className="hidden md:flex">
    <CreateButton label="Add a suggestion" />
  </TopToolbar>
);

const ShidduchimBody = ({ singleList }: { singleList: Single[] }) => {
  const location = useLocation();
  const matchShow = matchPath("/shidduchim/:id/show", location.pathname);
  const { data, filterValues, setFilters, displayedFilters } = useListContext();

  const singleId = (filterValues as Record<string, unknown> | undefined)
    ?.single_id as Identifier | undefined;
  const count = data?.length ?? 0;

  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          {singleList.length > 1 ? (
            <div className="mb-3 inline-flex flex-wrap gap-0.5 rounded-full border bg-secondary p-0.5">
              {singleList.map((single) => (
                <button
                  key={single.id}
                  type="button"
                  // Task 2 (AC 4): setFilters is what writes single_id into
                  // the URL's `filter` param — filterDefaultValues only ever
                  // supplies the INITIAL value.
                  onClick={() =>
                    setFilters(
                      { ...filterValues, single_id: single.id },
                      displayedFilters,
                    )
                  }
                  className={cn(
                    // Task 7: 32px -> 44px touch targets.
                    "min-h-11 rounded-full px-4 text-[13px] font-semibold transition-colors",
                    single.id === singleId
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {singleLabel(single)}
                </button>
              ))}
            </div>
          ) : null}
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            {count} redts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap a row to open it. Tap ⇄ to move it along.
          </p>
        </div>
      </div>

      <ShidduchimViewSwitch />
      <ShidduchShow open={!!matchShow} id={matchShow?.params.id} />
    </div>
  );
};

const ShidduchimNoSingles = () => (
  <EmptyState
    title="No singles yet"
    description="A shidduchim pipeline belongs to a single (the person you are redting for). Add a single first, then start tracking suggestions."
    actionLabel="Add a single"
    actionTo={buildNewPath("singles")}
  />
);

export default ShidduchimList;

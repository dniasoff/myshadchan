import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext } from "ra-core";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import { TopToolbar } from "../layout/TopToolbar";
import { EmptyState } from "../misc/EmptyState";
import type { Single } from "../types";
import { PipelineListSkeleton } from "./ShidduchimPipelineList";
import { ShidduchimViewSwitch } from "./ShidduchimViewSwitch";

const singleLabel = (single: Single) => single.first_name_en ?? `#${single.id}`;

const ShidduchimList = () => {
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

  // Review fix F4 (AC-5): this used to be a bare `return null` — one of the
  // audit's seven "null loading" states. `<List>` (and therefore
  // `ShidduchimViewSwitch`'s own shared loading gate) has not mounted yet
  // here — identity/singles are a precondition for it — so the fix is the
  // same loading SHAPE the gate renders once it does mount (AC-13), not a
  // second, differently-shaped spinner.
  if (!identity || singlesPending) return <PipelineListSkeleton />;
  if (!singles || singles.length === 0) return <ShidduchimNoSingles />;

  // Story 5.1: the create page is no longer matched inside this component —
  // it is `ShidduchCreatePage`, mounted by `buildEntityRoutes`'s own `new`
  // route (`shidduchim/index.ts`). `<List>` now renders unconditionally here.
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
            {/* View-neutral on purpose: this line sits ABOVE the Board /
                List / Cards switch, and the Board has no rows and no ⇄
                control, so naming either was telling a parent to do
                something the screen in front of them does not offer. */}
            Tap a suggestion to open it, or move it to another stage.
          </p>
        </div>
      </div>

      <ShidduchimViewSwitch />
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

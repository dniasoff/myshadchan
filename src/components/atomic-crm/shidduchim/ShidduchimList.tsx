import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext, useStore } from "ra-core";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useLocation, useNavigate } from "react-router";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import { TopToolbar } from "../layout/TopToolbar";
import { EmptyState } from "../misc/EmptyState";
import type { ShidduchSummary, Single } from "../types";
import { PipelineListSkeleton } from "./ShidduchimPipelineList";
import { ShidduchimViewSwitch } from "./ShidduchimViewSwitch";
import {
  getPendingShidduchAction,
  getPendingShidduchActions,
  getPendingShidduchExclusionFilter,
  type ShidduchLifecycleAction,
} from "./shidduchLifecycle";
import { ShidduchPendingActionBar } from "./ShidduchLifecycleActions";

const singleLabel = (single: Single) => single.first_name_en ?? `#${single.id}`;

type ArchiveFilterMode = "active" | "archived" | "all";

type StoredShidduchimListParams = {
  filter?: Record<string, unknown>;
  displayedFilters?: Record<string, boolean>;
};

const ARCHIVE_ALL_DISPLAYED_FILTER = "shidduchim.archive.all";

const hasOwn = (value: object | undefined, key: string) =>
  value ? Object.prototype.hasOwnProperty.call(value, key) : false;

const parseListParams = (
  search: string,
): StoredShidduchimListParams | undefined => {
  const query = new URLSearchParams(search);
  if (!query.toString()) return undefined;

  const parseObject = (key: "filter" | "displayedFilters") => {
    const raw = query.get(key);
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    filter: parseObject("filter"),
    displayedFilters: parseObject("displayedFilters") as
      Record<string, boolean> | undefined,
  };
};

const getExplicitArchiveFilterMode = (
  params: StoredShidduchimListParams | undefined,
): ArchiveFilterMode | undefined => {
  if (hasOwn(params?.filter, "archived_at@is")) return "active";
  if (hasOwn(params?.filter, "archived_at@not.is")) return "archived";
  if (params?.displayedFilters?.[ARCHIVE_ALL_DISPLAYED_FILTER] === true) {
    return "all";
  }
  return undefined;
};

const getInitialArchiveFilterMode = (
  search: string,
  storedParams: StoredShidduchimListParams | undefined,
): ArchiveFilterMode =>
  getExplicitArchiveFilterMode(parseListParams(search)) ??
  getExplicitArchiveFilterMode(storedParams) ??
  "active";

const getArchiveFilter = (mode: ArchiveFilterMode) => {
  if (mode === "active") return { "archived_at@is": null };
  if (mode === "archived") return { "archived_at@not.is": null };
  return {};
};

const ShidduchimList = () => {
  const location = useLocation();
  const [storedListParams] = useStore<StoredShidduchimListParams | undefined>(
    "shidduchim.listParams",
  );
  const [archiveMode, setArchiveMode] = useState<ArchiveFilterMode>(() =>
    getInitialArchiveFilterMode(location.search, storedListParams),
  );
  const archiveModeRef = useRef(archiveMode);
  const previousSearch = useRef(location.search);
  const searchValueRef = useRef("");

  useEffect(() => {
    if (previousSearch.current === location.search) return;
    previousSearch.current = location.search;
    const nextMode =
      getExplicitArchiveFilterMode(parseListParams(location.search)) ??
      "active";
    if (nextMode !== archiveModeRef.current) {
      archiveModeRef.current = nextMode;
      setArchiveMode(nextMode);
    }
  }, [location.search]);

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
      filterDefaultValues={{
        single_id: singles[0].id,
        "archived_at@is": null,
      }}
      // `ra-core` removes null values from ordinary list filters. Keep the
      // active archive predicate permanent so it cannot disappear from the
      // request after a search or single switch; archived/all modes replace
      // it from the parent state.
      filter={getArchiveFilter(archiveMode)}
      filters={[
        <ShidduchSearchInput
          key="q"
          source="q"
          alwaysOn
          searchValueRef={searchValueRef}
        />,
      ]}
      sort={{ field: "index", order: "ASC" }}
      pagination={null}
      actions={<ShidduchimActions />}
    >
      <ShidduchimBody
        archiveMode={archiveMode}
        onArchiveModeChange={(mode) => {
          archiveModeRef.current = mode;
          setArchiveMode(mode);
        }}
        searchValueRef={searchValueRef}
        singleList={singles}
      />
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

const ShidduchSearchInput = ({
  source = "q",
  searchValueRef,
}: {
  source?: string;
  alwaysOn?: boolean;
  searchValueRef: MutableRefObject<string>;
}) => {
  const { filterValues, setFilters, displayedFilters } = useListContext();
  const filterValue = (filterValues as Record<string, unknown>)[source];
  const externalValue = typeof filterValue === "string" ? filterValue : "";
  const [value, setValue] = useState(externalValue);

  useEffect(() => {
    searchValueRef.current = externalValue;
    setValue(externalValue);
  }, [externalValue, searchValueRef]);

  const clearSearch = () => {
    const next = { ...(filterValues as Record<string, unknown>) };
    delete next[source];
    searchValueRef.current = "";
    setValue("");
    setFilters(next, displayedFilters);
  };

  return (
    <div className="relative mt-auto flex flex-grow">
      <Input
        name={source}
        placeholder="Search"
        value={value}
        onChange={(event) => {
          const next = { ...(filterValues as Record<string, unknown>) };
          const nextValue = event.target.value;
          searchValueRef.current = nextValue;
          setValue(nextValue);
          if (nextValue) next[source] = nextValue;
          else delete next[source];
          setFilters(next, displayedFilters);
        }}
        className={value ? "flex-grow pr-16" : "flex-grow pr-8"}
      />
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {value ? (
        <button
          type="button"
          onClick={clearSearch}
          className="absolute right-8 top-1/2 size-11 -translate-y-1/2 rounded-full p-0 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Clear search"
        >
          <X className="mx-auto size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};

const ShidduchimBody = ({
  archiveMode,
  onArchiveModeChange,
  searchValueRef,
  singleList,
}: {
  archiveMode: ArchiveFilterMode;
  onArchiveModeChange: (mode: ArchiveFilterMode) => void;
  searchValueRef: MutableRefObject<string>;
  singleList: Single[];
}) => {
  const { data, filterValues, setFilters, displayedFilters } = useListContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingLifecycle, setPendingLifecycle] = useState<
    ShidduchLifecycleAction[]
  >(() => getPendingShidduchActions(location.state));
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const actions = getPendingShidduchActions(location.state);
    setPendingLifecycle(actions);
    const currentFilters = filterValues as Record<string, unknown>;
    const pendingFilter = getPendingShidduchExclusionFilter(location.state);
    const nextFilters = { ...currentFilters };
    delete nextFilters["id@neq"];
    delete nextFilters["id@not.in"];
    Object.assign(nextFilters, pendingFilter);
    const nextDisplayedFilters = { ...displayedFilters };
    if (archiveMode === "all") {
      nextDisplayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER] = true;
    } else {
      delete nextDisplayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER];
    }
    if (
      currentFilters["id@neq"] !== undefined ||
      currentFilters["id@not.in"] !== pendingFilter["id@not.in"] ||
      displayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER] !==
        nextDisplayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER]
    ) {
      setFilters(nextFilters, nextDisplayedFilters);
    }
    if (getPendingShidduchAction(location.state)) {
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: null,
      });
    }
  }, [
    archiveMode,
    displayedFilters,
    filterValues,
    location,
    navigate,
    setFilters,
  ]);

  const singleId = (filterValues as Record<string, unknown> | undefined)
    ?.single_id as Identifier | undefined;
  const count = data?.length ?? 0;
  const singleIdFilter = singleId ?? singleList[0]?.id;
  const { total: archivedCount = 0 } = useGetList<ShidduchSummary>(
    "shidduchim",
    {
      filter: {
        single_id: singleIdFilter,
        "archived_at@not.is": null,
      },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "archived_at", order: "DESC" },
    },
  );
  const allSuggestions = archiveMode === "all";

  const setArchiveFilter = (mode: "active" | "archived" | "all") => {
    const next = { ...(filterValues as Record<string, unknown>) };
    delete next["archived_at@is"];
    delete next["archived_at@not.is"];
    if (mode === "active") next["archived_at@is"] = null;
    if (mode === "archived") next["archived_at@not.is"] = null;
    const nextDisplayedFilters = { ...displayedFilters };
    if (mode === "all") {
      nextDisplayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER] = true;
    } else {
      delete nextDisplayedFilters[ARCHIVE_ALL_DISPLAYED_FILTER];
    }
    onArchiveModeChange(mode);
    setFilters(next, nextDisplayedFilters);
  };

  const getCurrentFilters = () => {
    const next = { ...(filterValues as Record<string, unknown>) };
    if (searchValueRef.current) next.q = searchValueRef.current;
    else delete next.q;
    return next;
  };

  return (
    <div className="w-full">
      {pendingLifecycle.length > 0 ? (
        <div className="mb-5 space-y-2">
          {pendingLifecycle.map((action) => (
            <ShidduchPendingActionBar
              key={`${String(action.id)}:${action.kind}`}
              action={action}
              onDone={(result) => {
                const remaining =
                  result === "failed"
                    ? pendingLifecycle.map((candidate) =>
                        String(candidate.id) === String(action.id)
                          ? { ...candidate, retryRequired: true }
                          : candidate,
                      )
                    : pendingLifecycle.filter(
                        (candidate) =>
                          String(candidate.id) !== String(action.id),
                      );
                setPendingLifecycle(remaining);
                const next = {
                  ...(filterValues as Record<string, unknown>),
                };
                delete next["id@neq"];
                delete next["id@not.in"];
                if (remaining.length > 0) {
                  next["id@not.in"] = `(${remaining
                    .map((candidate) => String(candidate.id))
                    .join(",")})`;
                }
                setFilters(next, displayedFilters);
                if (result === "failed") return;
                requestAnimationFrame(() => {
                  if (result === "restored") {
                    const row = document.querySelector<HTMLElement>(
                      `[data-shidduch-id="${String(action.id)}"] a`,
                    );
                    if (row) {
                      row.focus();
                      return;
                    }
                  }
                  const nextRow = Array.from(
                    document.querySelectorAll<HTMLElement>(
                      '[data-slot="pipeline-row"]',
                    ),
                  )
                    .find((row) => row.dataset.shidduchId !== String(action.id))
                    ?.querySelector<HTMLElement>("a");
                  (nextRow ?? heading.current)?.focus();
                });
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            role="tablist"
            aria-label="Suggestion archive"
            className="mb-3 inline-flex flex-wrap gap-1 rounded-full border bg-secondary p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={archiveMode === "active"}
              className={cn(
                "min-h-11 rounded-full px-4 text-sm font-semibold",
                archiveMode === "active"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setArchiveFilter("active")}
            >
              Active
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={archiveMode === "archived"}
              className={cn(
                "min-h-11 rounded-full px-4 text-sm font-semibold",
                archiveMode === "archived"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setArchiveFilter("archived")}
            >
              Archived
              <span className="ms-1 tabular-nums">({archivedCount})</span>
            </button>
            <label className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={allSuggestions}
                onChange={(event) =>
                  setArchiveFilter(event.target.checked ? "all" : "active")
                }
              />
              Include archived
            </label>
          </div>
          {singleList.length > 1 ? (
            <div className="mb-3 inline-flex flex-wrap gap-0.5 rounded-full border bg-secondary p-0.5">
              {singleList.map((single) => (
                <button
                  key={single.id}
                  type="button"
                  // Task 2 (AC 4): setFilters is what writes single_id into
                  // the URL's `filter` param — filterDefaultValues only ever
                  // supplies the INITIAL value.
                  onClick={() => {
                    setFilters(
                      { ...getCurrentFilters(), single_id: single.id },
                      displayedFilters,
                    );
                  }}
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
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-bold tracking-tight md:text-2xl"
          >
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

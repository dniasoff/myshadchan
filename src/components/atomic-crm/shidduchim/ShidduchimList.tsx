import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext, useStore } from "ra-core";
import { Search, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import { SingleSwitcherPill } from "../layout/TopBar";
import { TopToolbar } from "../layout/TopToolbar";
import { EmptyState } from "../misc/EmptyState";
import { useSelectedSingle } from "../singles/useSelectedSingle";
import type { ShidduchSummary, Single } from "../types";
import { PipelineListSkeleton } from "./ShidduchimPipelineList";
import { ShidduchTodoSummaryProvider } from "./ShidduchTodoSummary";
import { ShidduchimViewSwitch } from "./ShidduchimViewSwitch";
import {
  getPendingShidduchAction,
  getPendingShidduchActions,
  getPendingShidduchExclusionFilter,
  type ShidduchLifecycleAction,
} from "./shidduchLifecycle";
import { ShidduchPendingActionBar } from "./ShidduchLifecycleActions";

const singleLabel = (single: Single) =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `#${single.id}`;

const getExplicitSingleId = (search: string): Identifier | undefined => {
  const rawFilter = new URLSearchParams(search).get("filter");
  if (!rawFilter) return undefined;

  try {
    const parsed: unknown = JSON.parse(rawFilter);
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>).single_id;
    return typeof value === "string" || typeof value === "number"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

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
  const {
    singles,
    selected,
    selectedId,
    setSelectedId,
    isPending: singlesPending,
  } = useSelectedSingle();
  const isMobile = useIsMobile();
  const explicitSingleId = getExplicitSingleId(location.search);
  const explicitSingle =
    explicitSingleId == null
      ? undefined
      : singles.find(
          (single) => String(single.id) === String(explicitSingleId),
        );
  const explicitNavigationKey = explicitSingle
    ? `${location.key}:${location.pathname}${location.search}:${String(explicitSingle.id)}`
    : undefined;
  const appliedExplicitSingle = useRef<string | undefined>(undefined);
  const selectedSingle =
    explicitSingle && explicitNavigationKey !== appliedExplicitSingle.current
      ? explicitSingle
      : selected;

  useEffect(() => {
    if (!explicitSingle || !explicitNavigationKey) return;
    if (appliedExplicitSingle.current === explicitNavigationKey) return;
    appliedExplicitSingle.current = explicitNavigationKey;
    if (selectedId !== explicitSingle.id) setSelectedId(explicitSingle.id);
  }, [
    explicitSingle,
    explicitNavigationKey,
    location.pathname,
    location.search,
    selectedId,
    setSelectedId,
  ]);

  // Review fix F4 (AC-5): this used to be a bare `return null` — one of the
  // audit's seven "null loading" states. `<List>` (and therefore
  // `ShidduchimViewSwitch`'s own shared loading gate) has not mounted yet
  // here — identity/singles are a precondition for it — so the fix is the
  // same loading SHAPE the gate renders once it does mount (AC-13), not a
  // second, differently-shaped spinner.
  if (!identity || singlesPending) return <PipelineListSkeleton />;
  if (!singles || singles.length === 0 || !selectedSingle) {
    return <ShidduchimNoSingles />;
  }

  // Story 5.1: the create page is no longer matched inside this component —
  // it is `ShidduchCreatePage`, mounted by `buildEntityRoutes`'s own `new`
  // route (`shidduchim/index.ts`). `<List>` now renders unconditionally here.
  return (
    <>
      {isMobile && singles.length > 1 ? (
        <div className="mb-4">
          <SingleSwitcherPill className="h-11 min-h-11 w-full justify-between rounded-xl" />
        </div>
      ) : null}
      <List
        title={false}
        perPage={200}
        filterDefaultValues={{ "archived_at@is": null }}
        // `ra-core` removes null values from ordinary list filters. Keep the
        // active archive predicate permanent so it cannot disappear from the
        // request after a search or single switch; archived/all modes replace
        // it from the parent state.
        filter={{
          single_id: selectedSingle.id,
          ...getArchiveFilter(archiveMode),
        }}
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
          selectedSingle={selectedSingle}
        />
      </List>
    </>
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
  selectedSingle,
}: {
  archiveMode: ArchiveFilterMode;
  onArchiveModeChange: (mode: ArchiveFilterMode) => void;
  selectedSingle: Single;
}) => {
  const { data, filterValues, setFilters, displayedFilters } = useListContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingLifecycle, setPendingLifecycle] = useState<
    ShidduchLifecycleAction[]
  >(() => getPendingShidduchActions(location.state));
  const heading = useRef<HTMLHeadingElement | null>(null);
  const visibleRowOrder = useRef<string[]>([]);
  const visibleRowOrderByAction = useRef<Record<string, string[]>>({});
  const routeAction = getPendingShidduchAction(location.state);
  const routeActionId = routeAction?.id;
  const rowActionFocus = useRef<{
    id: string;
    order: string[];
  } | null>(null);

  useLayoutEffect(() => {
    if (routeActionId == null && pendingLifecycle.length > 0) return;
    const rowOrder = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="pipeline-row"]'),
    ).map((row) => row.dataset.shidduchId ?? "");
    if (routeActionId != null) {
      const id = String(routeActionId);
      const capturedOrder =
        rowOrder.length > 0 ? rowOrder : visibleRowOrder.current;
      if (!visibleRowOrderByAction.current[id]) {
        visibleRowOrderByAction.current[id] = capturedOrder;
      }
      if (routeAction?.origin === "row" && !rowActionFocus.current) {
        rowActionFocus.current = {
          id,
          order: capturedOrder,
        };
      }
      return;
    }
    visibleRowOrder.current = rowOrder;
  }, [data, pendingLifecycle.length, routeAction?.origin, routeActionId]);

  useLayoutEffect(() => {
    const pending = rowActionFocus.current;
    if (!pending) return;
    if (
      document.querySelector<HTMLElement>(`[data-shidduch-id="${pending.id}"]`)
    ) {
      return;
    }

    const currentRows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="pipeline-row"]'),
    );
    const actionRowIndex = pending.order.findIndex((id) => id === pending.id);
    const followingRowIds =
      actionRowIndex >= 0 ? pending.order.slice(actionRowIndex + 1) : [];
    const nextRow = followingRowIds
      .map((id) =>
        currentRows
          .find((row) => row.dataset.shidduchId === id)
          ?.querySelector<HTMLElement>("a"),
      )
      .find((row): row is HTMLElement => row != null);
    (nextRow ?? heading.current)?.focus();
    rowActionFocus.current = null;
  }, [data, location.state, pendingLifecycle.length]);

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

  const count = data?.length ?? 0;
  const { total: archivedCount = 0 } = useGetList<ShidduchSummary>(
    "shidduchim",
    {
      filter: {
        single_id: selectedSingle.id,
        "archived_at@not.is": null,
      },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "archived_at", order: "DESC" },
    },
  );
  const allSuggestions = archiveMode === "all";

  useEffect(() => {
    const currentSingleId = (filterValues as Record<string, unknown>)
      ?.single_id;
    if (String(currentSingleId) === String(selectedSingle.id)) return;
    setFilters(
      {
        ...(filterValues as Record<string, unknown>),
        single_id: selectedSingle.id,
      },
      displayedFilters,
    );
  }, [displayedFilters, filterValues, selectedSingle.id, setFilters]);

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

  return (
    <div className="w-full">
      {pendingLifecycle.length > 0 ? (
        <div className="mb-5 space-y-2">
          {pendingLifecycle.map((action) => (
            <ShidduchPendingActionBar
              key={`${String(action.id)}:${action.kind}`}
              action={action}
              focusOnMount={action.origin === "page"}
              onDone={(result) => {
                const actionOrder =
                  visibleRowOrderByAction.current[String(action.id)] ??
                  visibleRowOrder.current;
                const actionRowIndex = actionOrder.findIndex(
                  (id) => id === String(action.id),
                );
                const followingRowIds =
                  actionRowIndex >= 0
                    ? actionOrder.slice(actionRowIndex + 1)
                    : [];
                delete visibleRowOrderByAction.current[String(action.id)];
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
                  const currentRows = Array.from(
                    document.querySelectorAll<HTMLElement>(
                      '[data-slot="pipeline-row"]',
                    ),
                  );
                  const nextRow = followingRowIds
                    .map((id) =>
                      currentRows
                        .find((row) => row.dataset.shidduchId === id)
                        ?.querySelector<HTMLElement>("a"),
                    )
                    .find((row): row is HTMLElement => row != null);
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
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-bold tracking-tight md:text-2xl"
          >
            {count} redts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Showing {singleLabel(selectedSingle)}
          </p>
        </div>
      </div>

      <ShidduchTodoSummaryProvider>
        <ShidduchimViewSwitch />
      </ShidduchTodoSummaryProvider>
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

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type {
  GlobalSearchResource,
  GlobalSearchResult,
  Shadchan,
  ShidduchSummary,
  Single,
} from "../types";

/** AC-5: fewer than this many characters triggers no data-provider call. */
const MIN_QUERY_LENGTH = 2;
/** Each group is a preview, not a full roster — five rows per resource. */
const PER_GROUP_LIMIT = 5;

export type GlobalSearchGroups = Record<
  GlobalSearchResource,
  GlobalSearchResult[]
>;

/**
 * `GlobalSearch.tsx`'s open/closed dialog state lives HERE, not there,
 * purely to satisfy `react-refresh/only-export-components`: that file
 * exports two components (`GlobalSearchProvider`, `GlobalSearch`), and this
 * file already exports only hooks — co-locating a non-component hook
 * (`useGlobalSearchDialog`) with those components would trip the lint rule
 * (fast refresh can't tell a hook export from a component export apart in a
 * mixed file), and `src/components/atomic-crm`'s inline lint-suppression
 * budget (`scripts/check-suppressions.mjs`) is already at capacity, so
 * silencing the rule with a comment is not the available fix. Not otherwise
 * related to the fan-out fetch this file's name describes.
 */
export interface GlobalSearchDialogControls {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const GlobalSearchContext =
  createContext<GlobalSearchDialogControls | null>(null);

/**
 * A no-op stand-in for a caller rendered outside any `GlobalSearchProvider`
 * — mirrors `RecordLink`'s own "degrade, log, never throw" contract for a
 * cross-cutting chrome primitive (`entity360/RecordLink.tsx`): a chrome
 * component mounted in isolation (e.g. an existing narrower unit test for
 * `MobileNavigation`'s "More" menu, written before this story) must still
 * render, not blank its whole subtree over a missing ancestor it has no way
 * to know about.
 */
const MISSING_PROVIDER_FALLBACK: GlobalSearchDialogControls = {
  isOpen: false,
  open: () => {
    console.error(
      "useGlobalSearchDialog: open() called outside a GlobalSearchProvider; ignoring.",
    );
  },
  close: () => {},
};

/**
 * The dialog's open/closed state, shared by every chrome trigger (TopBar's
 * icon button, `MobileNavigation`'s "More" menu item) so all of them open
 * the SAME `<GlobalSearch/>` instance (AC-1) rather than each mounting its
 * own.
 */
export function useGlobalSearchDialog(): GlobalSearchDialogControls {
  const context = useContext(GlobalSearchContext);
  return context ?? MISSING_PROVIDER_FALLBACK;
}

// A single shared reference: never mutated, only ever read or replaced
// wholesale (coding-style.md's immutability rule), so reusing it as both
// the initial state and the short-circuit result below costs nothing.
const EMPTY_GROUPS: GlobalSearchGroups = {
  singles: [],
  shidduchim: [],
  shadchanim: [],
};

export interface UseGlobalSearchResult {
  groups: GlobalSearchGroups;
  isPending: boolean;
}

const joinName = (parts: Array<string | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

function mapSingle(record: Single): GlobalSearchResult {
  const labelEn = joinName([record.first_name_en, record.last_name_en]);
  const labelHe = joinName([record.first_name_he, record.last_name_he]);
  return {
    resource: "singles",
    id: record.id,
    label_en: labelEn || `#${record.id}`,
    label_he: labelHe || null,
  };
}

function mapShidduch(record: ShidduchSummary): GlobalSearchResult {
  return {
    resource: "shidduchim",
    id: record.id,
    label_en: record.name_en || `#${record.id}`,
    label_he: record.name_he ?? null,
    subtitle: record.shadchan_name ?? null,
  };
}

function mapShadchan(record: Shadchan): GlobalSearchResult {
  return {
    resource: "shadchanim",
    id: record.id,
    label_en: record.name,
    label_he: record.name_he ?? null,
    subtitle: record.location ?? null,
  };
}

/**
 * Story 4.5's global-search fan-out: given an already-debounced `query`
 * (the 300ms debounce itself lives in `GlobalSearch.tsx`, Task 2 — this hook
 * only ever sees the settled value), issues three `getList` calls in
 * parallel through `useDataProvider()`.
 *
 * Deliberately a hook over `useDataProvider()`, never a dataProvider custom
 * method — load-bearing, do not "improve" it back. The `q` -> `@or` search
 * hooks Stories 4.1/4.3 wired (`dataProvider.ts`'s `lifeCycleCallbacks`) are
 * applied by `withLifecycleCallbacks`, which WRAPS the object
 * `getDataProviderWithCustomMethods()` returns. A custom method calling
 * `this.getList(...)` runs INSIDE that wrapper and would never see them, so
 * the raw `q` would 400 against PostgREST (the same dead-hook trap 4.1's Dev
 * Notes document). `useDataProvider()` hands out the fully wrapped provider,
 * so this fan-out takes exactly the `getList` path every list screen uses.
 *
 * RULING 7: `references` is deliberately absent — three resources, not four
 * (see the story's Dev Notes, "Why references is not searchable").
 */
export function useGlobalSearch(query: string): UseGlobalSearchResult {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [groups, setGroups] = useState<GlobalSearchGroups>(EMPTY_GROUPS);
  const [isPending, setIsPending] = useState(false);
  // No React Query cache backs this one-shot fetch (Dev Notes), so a
  // superseded request has to police its own staleness: without this guard,
  // a slow response for an earlier query could land after a faster response
  // for a later one and clobber it.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = ++latestRequestId.current;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      // AC-5: all three group keys present as empty arrays, not omitted —
      // and getList is called zero times.
      setGroups(EMPTY_GROUPS);
      setIsPending(false);
      return;
    }

    setIsPending(true);

    Promise.all([
      dataProvider.getList<Single>("singles", {
        filter: { q: trimmed },
        pagination: { page: 1, perPage: PER_GROUP_LIMIT },
        sort: { field: "first_name_en", order: "ASC" },
      }),
      dataProvider.getList<ShidduchSummary>("shidduchim", {
        filter: { q: trimmed },
        pagination: { page: 1, perPage: PER_GROUP_LIMIT },
        sort: { field: "name_en", order: "ASC" },
      }),
      dataProvider.getList<Shadchan>("shadchanim", {
        filter: { q: trimmed },
        pagination: { page: 1, perPage: PER_GROUP_LIMIT },
        sort: { field: "name", order: "ASC" },
      }),
    ])
      .then(([singlesResult, shidduchimResult, shadchanimResult]) => {
        if (latestRequestId.current !== requestId) return;
        setGroups({
          singles: singlesResult.data.map(mapSingle),
          shidduchim: shidduchimResult.data.map(mapShidduch),
          shadchanim: shadchanimResult.data.map(mapShadchan),
        });
        setIsPending(false);
      })
      .catch((error: unknown) => {
        if (latestRequestId.current !== requestId) return;
        console.error("Global search fan-out failed", error);
        setGroups(EMPTY_GROUPS);
        setIsPending(false);
      });
  }, [dataProvider, query]);

  return { groups, isPending };
}

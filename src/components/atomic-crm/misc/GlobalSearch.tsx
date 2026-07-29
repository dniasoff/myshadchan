import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslate } from "ra-core";
import { useNavigate } from "react-router";

import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";

import { buildRecordPath } from "../entity360/entityPaths";
import { RecordLink } from "../entity360/RecordLink";
import type { GlobalSearchResource, GlobalSearchResult } from "../types";
import {
  GlobalSearchContext,
  useGlobalSearch,
  useGlobalSearchDialog,
} from "./useGlobalSearch";
import type { GlobalSearchDialogControls } from "./useGlobalSearch";

/** 300ms — AC-5's typing debounce. */
const DEBOUNCE_MS = 300;

/** Canonical render order — same order Task 1's fan-out issues its calls in. */
const RESOURCE_ORDER: GlobalSearchResource[] = [
  "singles",
  "shidduchim",
  "shadchanim",
];

/**
 * Wraps one shell (`layout/Layout.tsx` desktop, `layout/MobileLayout.tsx`
 * mobile — Task 4) around a single `<GlobalSearch/>`. The shells are
 * mutually exclusive (`root/CRM.tsx` picks by `useIsMobile`), so exactly one
 * provider + one dialog + one `(Cmd|Ctrl)+K` listener is ever mounted.
 */
export function GlobalSearchProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo<GlobalSearchDialogControls>(
    () => ({ isOpen, open, close }),
    [isOpen, open, close],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
    </GlobalSearchContext.Provider>
  );
}

const resultKey = (result: GlobalSearchResult): string =>
  `${result.resource}-${result.id}`;

/**
 * Story 4.5: one search reaching everywhere (AC-1). A `CommandDialog`
 * (`@/components/ui/command.tsx`, over `cmdk`) rather than a `/search`
 * route — see the story's Dev Notes, "Why a command dialog, not a `/search`
 * route".
 *
 * Selection is handled entirely through `CommandItem`'s own `onSelect`, not
 * through `RecordLink`'s click (contract §7 rule 0 closes `RecordLink` to
 * five props — no `onClick`, no `ref`, no spread — so it cannot forward the
 * `role`/`aria-selected`/keyboard wiring `cmdk`'s `asChild` composition
 * would need to inject onto it). The wrapping `<div onClickCapture>` below
 * is the "ancestor's capture-phase click handler" the Dev Notes name as the
 * alternative to `asChild`: it blocks `RecordLink`'s own click-driven
 * navigation so a mouse click and a keyboard Enter both resolve through the
 * exact same `onSelect` path — one navigation per activation, not two.
 */
export function GlobalSearch(): ReactNode {
  const { isOpen, open, close } = useGlobalSearchDialog();
  const translate = useTranslate();
  const navigate = useNavigate();

  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { groups, isPending } = useGlobalSearch(debouncedQuery);

  // AC-1: the (Cmd|Ctrl)+K shortcut, available on every screen. This
  // component is mounted exactly once per shell (Task 4), so the listener
  // cannot double-fire.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Task 2 (AC-5): the raw keystroke is held locally so the input feels
  // instant; `useGlobalSearch` (Task 1) only ever sees the value 300ms after
  // the last keystroke. Cleanup clears the pending timeout on every
  // keystroke, so only the trailing one ever fires.
  useEffect(() => {
    const timeoutId = setTimeout(
      () => setDebouncedQuery(rawQuery),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [rawQuery]);

  // Cancel-on-close (Dev Notes, "no React Query wiring needed ... a
  // cancel-on-close fetch"): clearing both queries drops any pending
  // debounce timeout and stops the next open from flashing a stale result
  // set from the last search.
  useEffect(() => {
    if (!isOpen) {
      setRawQuery("");
      setDebouncedQuery("");
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (result: GlobalSearchResult) => {
      close();
      navigate(buildRecordPath(result.resource, result.id));
    },
    [close, navigate],
  );

  const trimmedQuery = rawQuery.trim();
  const hasAnyResult = RESOURCE_ORDER.some(
    (resource) => groups[resource].length > 0,
  );

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(next) => (next ? open() : close())}
      title={translate("crm.global_search.title", { _: "Search" })}
      description={translate("crm.global_search.description", {
        _: "Search singles, shidduchim and shadchanim",
      })}
    >
      <CommandInput
        value={rawQuery}
        onValueChange={setRawQuery}
        placeholder={translate("crm.global_search.placeholder", {
          _: "Search singles, shidduchim, shadchanim…",
        })}
      />
      <CommandList>
        {trimmedQuery.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {translate("crm.global_search.hint", {
              _: "Search singles, shidduchim, shadchanim…",
            })}
          </div>
        ) : isPending ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner size="small" />
            {translate("crm.global_search.loading", { _: "Searching…" })}
          </div>
        ) : !hasAnyResult ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {translate("crm.global_search.no_results", { _: "No results" })}
          </div>
        ) : (
          // Blocks RecordLink's own click-driven navigation (see the
          // component doc comment above) so onSelect below is the ONLY
          // navigation path, for both mouse and keyboard activation.
          <div onClickCapture={(event) => event.preventDefault()}>
            {RESOURCE_ORDER.map((resource) => {
              const results = groups[resource];
              if (results.length === 0) return null;
              return (
                <CommandGroup
                  key={resource}
                  heading={translate(`resources.${resource}.name`, {
                    smart_count: 2,
                    _: resource,
                  })}
                >
                  {results.map((result) => (
                    <CommandItem
                      key={resultKey(result)}
                      value={resultKey(result)}
                      // Guarantees this item is never hidden by cmdk's own
                      // client-side re-filtering: `CommandInput` mirrors the
                      // RAW (undebounced) keystroke into cmdk's internal
                      // `search` state, which can race ahead of the results
                      // currently on screen (still matching the PREVIOUS,
                      // narrower debounced query). Including the live raw
                      // query as a keyword means cmdk's fuzzy scorer always
                      // finds an exact match, so it never double-filters a
                      // result our own server-side search already returned.
                      keywords={[rawQuery]}
                      onSelect={() => handleSelect(result)}
                    >
                      <RecordLink
                        resource={result.resource}
                        id={result.id}
                        className="flex min-w-0 flex-1 flex-col"
                      >
                        <span className="truncate">{result.label_en}</span>
                        {result.subtitle ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {result.subtitle}
                          </span>
                        ) : null}
                      </RecordLink>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}

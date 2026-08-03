import { useEffect, useState } from "react";
import type { Identifier } from "ra-core";
import { useGetList, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { PIPELINE_STATES } from "../shidduchim/pipelineStates";
import type { ShidduchSummary } from "../types";

/** Same debounce/result-count shape as `misc/GlobalSearch.tsx`'s Task 2 —
 * this is the same "typing feels instant, the data-provider call doesn't
 * fire on every keystroke" idiom, applied to one resource instead of three. */
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 5;

export interface LinkToShidduchSearchProps {
  /** Called with the chosen suggestion's id when "Link" is pressed. Left to
   * the caller to await and handle notify/refresh/navigation — this
   * component owns only the search UI, not what happens after a link. */
  onLink: (shidduchimId: Identifier) => void | Promise<void>;
  /** Review fix (F6, Story 10.1): the search box and every "Link" button
   * disable while the CALLER is busy with some other in-flight action
   * (Save, Skip, or another Link) — not just the row that was clicked. This
   * component owns only the search UI, so it cannot know about a sibling
   * action on its own; the caller passes its own busy flag through. */
  disabled?: boolean;
}

/**
 * AC 5 / AC 8, Story 10.1 Task 3: "link to an existing suggestion" search,
 * shared by `InboxResolveDialog.tsx` and `ShareTarget.tsx` — a single
 * component rather than one per screen, so the query shape (Story 4.3's
 * `"shidduchim"`-keyed full-text search entry, `dataProvider.ts`) and the
 * cross-account isolation it inherits from `shidduchim_summary`'s RLS are
 * exercised identically everywhere it appears.
 */
export function LinkToShidduchSearch({
  onLink,
  disabled = false,
}: LinkToShidduchSearchProps) {
  const translate = useTranslate();
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [linkingId, setLinkingId] = useState<Identifier | null>(null);

  useEffect(() => {
    const timeoutId = setTimeout(
      () => setDebouncedQuery(rawQuery),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [rawQuery]);

  const trimmedQuery = debouncedQuery.trim();
  // The custom getList override (dataProvider.ts) routes "shidduchim" reads
  // through shidduchim_summary — keyed to "shidduchim" here, never
  // "shidduchim_summary" directly, is what actually fires 4.3's search hook
  // (the dead-hook trap: a hook keyed to the redirect TARGET never sees a
  // request made against the SOURCE name).
  const { data, isPending, error } = useGetList<ShidduchSummary>(
    "shidduchim",
    {
      filter: { q: trimmedQuery },
      pagination: { page: 1, perPage: RESULT_LIMIT },
      sort: { field: "name_en", order: "ASC" },
    },
    { enabled: trimmedQuery.length > 0 },
  );

  const handleLink = async (shidduchimId: Identifier) => {
    setLinkingId(shidduchimId);
    try {
      await onLink(shidduchimId);
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={rawQuery}
        onChange={(event) => setRawQuery(event.target.value)}
        // Review fix (F1, BLOCKING): this input lives inside the SAME
        // ra-core <Form> as the "create a new suggestion" fields (both
        // ShareTarget.tsx and InboxResolveDialog.tsx render it below
        // ShidduchInputs/the shadchan picker), whose SaveButton is
        // type="submit". Pressing Enter here therefore submitted THAT form
        // — creating a second, duplicate suggestion — instead of doing
        // nothing, which is what a search box's Enter key must do (AC 5:
        // linking "does not create a second, duplicate suggestion").
        // Swallowed here, once, rather than in every screen that reuses
        // this component.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        disabled={disabled}
        placeholder={translate("crm.inbox.linkSearch.placeholder", {
          _: "Or link to an existing suggestion…",
        })}
        aria-label={translate("crm.inbox.linkSearch.label", {
          _: "Search your suggestions",
        })}
      />
      {trimmedQuery.length === 0 ? null : isPending ? (
        <p className="text-sm text-muted-foreground">
          {translate("crm.inbox.linkSearch.loading", { _: "Searching…" })}
        </p>
      ) : error ? (
        // Review fix (F3, HIGH): a failed search (e.g. PostgREST rejecting
        // a malformed query) must never render as "No matching
        // suggestions." — that is indistinguishable from a real empty
        // result and hides a genuine failure as a false negative.
        <p className="text-sm text-destructive">
          {translate("crm.inbox.linkSearch.searchError", {
            _: "Couldn't search your suggestions — try a different search.",
          })}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("crm.inbox.linkSearch.empty", {
            _: "No matching suggestions.",
          })}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.map((shidduch) => {
            const stateDef = PIPELINE_STATES.find(
              (state) => state.value === shidduch.pipeline_state,
            );
            return (
              <li
                key={String(shidduch.id)}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={
                      stateDef
                        ? { backgroundColor: `var(${stateDef.token})` }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {shidduch.name_en || `#${shidduch.id}`}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    · {stateDef?.label ?? shidduch.pipeline_state}{" "}
                    {translate("crm.inbox.linkSearch.onBoard", {
                      _: "already on the board",
                    })}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={disabled || linkingId === shidduch.id}
                  onClick={() => handleLink(shidduch.id)}
                >
                  {translate("crm.inbox.linkSearch.link", { _: "Link" })}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

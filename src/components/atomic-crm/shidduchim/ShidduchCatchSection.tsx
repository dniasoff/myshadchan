import { useCallback, useState } from "react";
import type { Identifier } from "ra-core";
import { useRedirect } from "ra-core";

import type { ShidduchCatchSuggestion } from "../types";
import { ShidduchCatchPanel } from "./ShidduchCatchPanel";
import { EMPTY_CATCH, useShidduchCatch } from "./useShidduchCatch";

/**
 * Container for the dedupe "catch" panel on a shidduch's 360 view (E3). Fetches
 * catch_shidduch(), then hands its output to the pure panel.
 *
 * Confirm and dismiss are session-level, exactly like match-on-entry's dismiss
 * (useReferenceMatch): nothing is written and nothing merges. Confirm takes the
 * user to the prior suggestion so they can compare the two side by side and
 * decide what to do; dismiss hides that prior suggestion for the rest of the
 * session. Persisting a dismissal across reloads would need a decision store and
 * is deliberately left for a later pass — a real catch is worth re-surfacing
 * until the two records are actually reconciled.
 */
export const ShidduchCatchSection = ({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}) => {
  const redirect = useRedirect();
  const { data } = useShidduchCatch(shidduchimId);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = useCallback((priorShidduchimId: Identifier) => {
    setDismissed((current) => new Set(current).add(String(priorShidduchimId)));
  }, []);

  const confirm = useCallback(
    (suggestion: ShidduchCatchSuggestion) => {
      redirect(
        `/shidduchim/${suggestion.prior_shidduchim_id}/show`,
        undefined,
        undefined,
        undefined,
        { _scrollToTop: false },
      );
    },
    [redirect],
  );

  const catchData = data ?? EMPTY_CATCH;
  const suggestions = catchData.suggestions.filter(
    (suggestion) => !dismissed.has(String(suggestion.prior_shidduchim_id)),
  );

  return (
    <ShidduchCatchPanel
      suggestions={suggestions}
      dates={catchData.dates}
      onConfirm={confirm}
      onDismiss={dismiss}
    />
  );
};

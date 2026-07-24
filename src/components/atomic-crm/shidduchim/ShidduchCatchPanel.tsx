import { format } from "date-fns";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { StateChip } from "../misc/StateChip";
import type { ShidduchCatchSuggestion, ShidduchDatePrior } from "../types";

/**
 * The dedupe "catch" review surface (E3): "you've come across this person
 * before." Calm, high-confidence relief — never an error. It deliberately reuses
 * the honey `--attention` treatment the design language reserves for this catch
 * (design-language §5.8), the same tokens the references RepeatRecognitionPanel
 * uses — never red.
 *
 * Two rules the markup enforces, inherited from match-on-entry (AD-5/FR20):
 *  - the deciding facts are always shown, so the user sees WHY two suggestions
 *    look like the same person rather than trusting a bare score;
 *  - nothing merges. There are exactly two actions per prior suggestion and
 *    neither is a default: confirm the match (and go compare it) or dismiss it as
 *    a different person. Age is shown only as context — it is never a matching
 *    signal (FR11). This panel is a pure presentation of catch_shidduch() output.
 */

const confidenceFallback = (confidence: number): string => {
  if (confidence >= 0.9) return "Strong match";
  if (confidence >= 0.7) return "Likely match";
  return "Possible match";
};

const formatDateOn = (iso?: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, "MMM yyyy");
};

const displayName = (nameEn?: string | null, nameHe?: string | null): string =>
  nameEn || nameHe || "this person";

const priorContext = (suggestion: ShidduchCatchSuggestion): string =>
  [
    suggestion.child_first_name_en
      ? `suggested for ${suggestion.child_first_name_en}`
      : null,
    suggestion.shadchan_name ? `via ${suggestion.shadchan_name}` : null,
    typeof suggestion.age === "number" ? `age ${suggestion.age}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export const ShidduchCatchPanel = ({
  suggestions,
  dates,
  onConfirm,
  onDismiss,
}: {
  suggestions: ShidduchCatchSuggestion[];
  dates: ShidduchDatePrior[];
  /** "Yes, the same person" — take the user to the prior suggestion to compare. */
  onConfirm: (suggestion: ShidduchCatchSuggestion) => void;
  /** "No, a different person" — hide this prior suggestion for the session. */
  onDismiss: (priorShidduchimId: Identifier) => void;
}) => {
  if (suggestions.length === 0 && dates.length === 0) return null;

  return (
    <Card
      className="rounded-2xl border-[color-mix(in_oklch,var(--attention)_35%,var(--border))]
        bg-[color-mix(in_oklch,var(--attention)_10%,var(--card))] shadow-sm"
    >
      <CardContent className="flex flex-col gap-4 pt-6">
        <div>
          <p className="font-display text-base font-semibold">
            You've come across this person before
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing is merged automatically — confirm the match or say it's
            someone else.
          </p>
        </div>

        {suggestions.map((suggestion) => (
          <div
            key={String(suggestion.prior_shidduchim_id)}
            className="flex flex-col gap-3 rounded-xl border
              border-[color-mix(in_oklch,var(--attention)_25%,var(--border))]
              bg-card p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-semibold">
                    {displayName(suggestion.name_en, suggestion.name_he)}
                  </span>
                  {suggestion.name_he ? (
                    <span
                      className="font-hebrew text-sm text-muted-foreground"
                      dir="rtl"
                    >
                      {suggestion.name_he}
                    </span>
                  ) : null}
                </div>
                {priorContext(suggestion) ? (
                  <p className="text-sm text-muted-foreground">
                    {priorContext(suggestion)}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StateChip state={suggestion.pipeline_state} />
                <span className="text-xs font-medium text-muted-foreground">
                  {confidenceFallback(suggestion.confidence)}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Why we think so
              </p>
              <ul className="mt-1 list-inside list-disc text-sm">
                {suggestion.deciding_facts.map((fact, index) => (
                  <li key={`${fact.signal}-${index}`}>{fact.detail}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="lg"
                onClick={() => onConfirm(suggestion)}
              >
                Confirm match
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => onDismiss(suggestion.prior_shidduchim_id)}
              >
                Dismiss — different person
              </Button>
            </div>
          </div>
        ))}

        {dates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Previously dated
            </p>
            <ul className="flex flex-col divide-y divide-[color-mix(in_oklch,var(--attention)_20%,var(--border))]">
              {dates.map((prior) => (
                <li
                  key={String(prior.date_record_id)}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 text-sm">
                    {displayName(prior.person_name_en, prior.person_name_he)}
                    {prior.child_first_name_en
                      ? ` · with ${prior.child_first_name_en}`
                      : ""}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {[
                      prior.outcome?.replace(/_/g, " "),
                      formatDateOn(prior.date_on),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReferenceMatchCandidate } from "../types";

/**
 * The confirm-or-dismiss surface for match-on-entry (FR20/FR42).
 *
 * Deliberately reuses the honey/amber "catch" treatment the design system
 * already uses for the duplicate/already-dated catch: this is relief, not an
 * error. The user has been saved a duplicate, and nothing has gone wrong.
 *
 * Two rules the copy and the markup both enforce:
 *  - the deciding facts are always shown, so the user can see WHY these two
 *    records look like the same person rather than trusting a score;
 *  - there are exactly two actions, and neither of them is the default. Nothing
 *    links until the user says so.
 */

const confidenceLabel = (confidence: number): string => {
  if (confidence >= 0.9) return "crm.references.match.confidence.strong";
  if (confidence >= 0.7) return "crm.references.match.confidence.likely";
  return "crm.references.match.confidence.possible";
};

const confidenceFallback = (confidence: number): string => {
  if (confidence >= 0.9) return "Strong match";
  if (confidence >= 0.7) return "Likely match";
  return "Possible match";
};

const displayName = (candidate: ReferenceMatchCandidate): string =>
  candidate.name_en || candidate.name_he || "this person";

export const ReferenceMatchPanel = ({
  candidates,
  onConfirm,
  onDismiss,
  isBusy = false,
}: {
  candidates: ReferenceMatchCandidate[];
  /** Link the mention to the existing reference instead of creating a new one. */
  onConfirm: (candidate: ReferenceMatchCandidate) => void;
  onDismiss: (referenceId: Identifier) => void;
  isBusy?: boolean;
}) => {
  const translate = useTranslate();

  if (candidates.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40">
      <CardContent className="flex flex-col gap-4 pt-6">
        <div>
          <p className="text-base font-semibold text-amber-950 dark:text-amber-100">
            {translate("crm.references.match.title", {
              _: "You may have spoken to this person before",
            })}
          </p>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
            {translate("crm.references.match.subtitle", {
              _: "Linking keeps everything you already know about them in one place.",
            })}
          </p>
        </div>

        {candidates.map((candidate) => (
          <div
            key={String(candidate.reference_id)}
            className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-background p-4 dark:border-amber-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <Link
                  to={`/references/${candidate.reference_id}/show`}
                  className="text-base font-medium hover:underline"
                >
                  {displayName(candidate)}
                </Link>
                {candidate.name_he ? (
                  <span className="ms-2 text-sm text-muted-foreground">
                    {candidate.name_he}
                  </span>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {[candidate.relationship, candidate.phone, candidate.school]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {translate(confidenceLabel(candidate.confidence), {
                  _: confidenceFallback(candidate.confidence),
                })}
              </span>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {translate("crm.references.match.why", {
                  _: "Why we think so",
                })}
              </p>
              <ul className="mt-1 list-inside list-disc text-sm">
                {candidate.deciding_facts.map((fact, index) => (
                  <li key={`${fact.signal}-${index}`}>{fact.detail}</li>
                ))}
              </ul>
            </div>

            {candidate.linked_shidduchim_count > 0 ? (
              <p className="text-sm text-muted-foreground">
                {translate("crm.references.match.alreadyLinked", {
                  smart_count: candidate.linked_shidduchim_count,
                  _: "Already linked to %{smart_count} other singles",
                })}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="lg"
                disabled={isBusy}
                onClick={() => onConfirm(candidate)}
              >
                {translate("crm.references.match.confirm", {
                  name: displayName(candidate),
                  _: "Yes, this is %{name}",
                })}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={isBusy}
                onClick={() => onDismiss(candidate.reference_id)}
              >
                {translate("crm.references.match.dismiss", {
                  _: "No, different person",
                })}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MergeResolution, ReferenceMergeCollision } from "../types";
import { CallStatusChip } from "./CallStatusChip";

/**
 * Resolving the collision that has no contacts equivalent: both duplicates hold
 * a call log for the SAME shidduch.
 *
 * The merge cannot proceed until every one of these has an answer. Showing both
 * sides verbatim is the point — the user is choosing between two real
 * conversations, and the option they usually want is "keep both", because a
 * shadchan rarely wants either account of a call thrown away.
 */

const OPTIONS: ReadonlyArray<{
  id: MergeResolution;
  key: string;
  fallback: string;
}> = [
  {
    id: "winner",
    key: "crm.references.merge.keepWinner",
    fallback: "Keep the one being kept",
  },
  {
    id: "loser",
    key: "crm.references.merge.keepLoser",
    fallback: "Keep the duplicate's",
  },
  { id: "both", key: "crm.references.merge.keepBoth", fallback: "Keep both" },
];

export const CollisionResolver = ({
  collisions,
  resolutions,
  onChange,
}: {
  collisions: ReferenceMergeCollision[];
  resolutions: Record<string, MergeResolution>;
  onChange: (shidduchimId: Identifier, resolution: MergeResolution) => void;
}) => {
  const translate = useTranslate();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        {translate("crm.references.merge.collisionsTitle", {
          smart_count: collisions.length,
          _: "Both records have a call log for %{smart_count} of the same singles",
        })}
      </p>

      {collisions.map((collision) => {
        const chosen = resolutions[String(collision.shidduchim_id)];
        return (
          <Card
            key={String(collision.shidduchim_id)}
            className="border-amber-200 dark:border-amber-900"
          >
            <CardContent className="flex flex-col gap-3 pt-6">
              <p className="font-medium">{collision.shidduch_name_en}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {translate("crm.references.merge.keeping", {
                        _: "Keeping",
                      })}
                    </span>
                    <CallStatusChip
                      status={collision.winner_link.call_status}
                    />
                  </div>
                  <p className="whitespace-pre-line">
                    {collision.winner_link.what_they_said ||
                      translate("crm.references.merge.nothingRecorded", {
                        _: "Nothing recorded",
                      })}
                  </p>
                </div>

                <div className="rounded-md border p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {translate("crm.references.merge.removing", {
                        _: "Removing",
                      })}
                    </span>
                    <CallStatusChip status={collision.loser_link.call_status} />
                  </div>
                  <p className="whitespace-pre-line">
                    {collision.loser_link.what_they_said ||
                      translate("crm.references.merge.nothingRecorded", {
                        _: "Nothing recorded",
                      })}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={chosen === option.id}
                    onClick={() => onChange(collision.shidduchim_id, option.id)}
                    className={cn(
                      "min-h-[44px] rounded-md border px-4 text-sm font-medium",
                      chosen === option.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background",
                    )}
                  >
                    {translate(option.key, { _: option.fallback })}
                  </button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {translate("crm.references.merge.nothingLost", {
                  _: "Whichever you choose, the other account of the call is kept on the timeline.",
                })}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

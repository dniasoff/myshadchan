import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordLink } from "../entity360/RecordLink";
import type { ReferenceLinkSummary } from "../types";
import { CallStatusChip } from "./CallStatusChip";
import { summarizeCallProgress } from "./callStatus";
import { filterOtherConversations } from "./repeatRecognition";

/**
 * Repeat recognition (FR42): "you have spoken to this person before, about these
 * other singles."
 *
 * This is the panel the imported design promised in copy and never built — it
 * shipped a hard-coded string per mock reference. Here it is a real query over
 * reference_links, so it stays true as the book grows.
 *
 * Rendered in two places from the same data: standalone on the reference's own
 * page, and compact inside a shidduch's 360 view, where the shidduch you are
 * already looking at is excluded (`excludeShidduchimId`) — telling someone they
 * have spoken to a reference about the single they are currently reading is
 * noise.
 *
 * `isPending` (RULING 7 verification finding): `links` starts as `[]` while
 * `useReferenceLinks` is still in flight, which is indistinguishable from a
 * reference that genuinely has no other conversations. Without this flag the
 * panel rendered its "no other conversations" copy on every load, briefly,
 * for a reference that has plenty — the exact feature the owner asked for,
 * saying the opposite while it warms up. `RepeatRecognitionSkeleton` reserves
 * the card's rough footprint instead of returning `null`, the same reasoning
 * `settings/ProfileSection.tsx` documents for its own skeleton (a late block
 * popping in shifts the page).
 */
export const RepeatRecognitionPanel = ({
  referenceName,
  links,
  isPending = false,
  excludeShidduchimId,
  compact = false,
}: {
  referenceName: string;
  links: ReferenceLinkSummary[];
  isPending?: boolean;
  excludeShidduchimId?: Identifier | null;
  compact?: boolean;
}) => {
  const translate = useTranslate();

  if (isPending) {
    return <RepeatRecognitionSkeleton compact={compact} />;
  }

  const others = filterOtherConversations(links, excludeShidduchimId);

  if (others.length === 0) {
    return compact ? null : (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {translate("crm.references.repeat.none", {
          _: "No other conversations with this person yet.",
        })}
      </p>
    );
  }

  const progress = summarizeCallProgress(others);

  return (
    <Card
      className="rounded-2xl border-[color-mix(in_oklch,var(--attention)_35%,var(--border))]
        bg-[color-mix(in_oklch,var(--attention)_10%,var(--card))] shadow-sm"
    >
      <CardContent className="flex flex-col gap-3 pt-6">
        <div>
          <p className="font-display text-base font-semibold">
            {translate("crm.references.repeat.title", {
              name: referenceName,
              smart_count: others.length,
              _: "You have spoken to %{name} about %{smart_count} other singles",
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate("crm.references.repeat.progress", {
              contacted: progress.contacted,
              total: progress.total,
              _: "%{contacted} of %{total} of those conversations happened",
            })}
          </p>
        </div>

        <ul className="flex flex-col divide-y divide-[color-mix(in_oklch,var(--attention)_20%,var(--border))]">
          {others.map((link) => (
            <li
              key={String(link.id)}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <RecordLink
                  resource="shidduchim"
                  id={link.shidduchim_id}
                  className="inline-flex min-h-11 items-center font-medium hover:underline md:min-h-0"
                >
                  {link.shidduch_name_en}
                </RecordLink>
                <p className="truncate text-sm text-muted-foreground">
                  {[link.effective_relationship, link.single_first_name_en]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <CallStatusChip status={link.call_status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

/**
 * Loading placeholder for `RepeatRecognitionPanel` — see the panel's own
 * `isPending` doc comment for why this exists at all. `aria-busy="true"`
 * matches this repo's shared skeleton idiom (`TasksTab`, `ActivityTab`,
 * `ShidduchShow`): a few `Skeleton` bars, never a bare `null` or the
 * component's own empty-state copy.
 */
const RepeatRecognitionSkeleton = ({ compact }: { compact: boolean }) => {
  if (compact) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm" aria-busy="true">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
};

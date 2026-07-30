import { useTranslate } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityAvatar } from "../entity360/EntityAvatar";
import type { Reference } from "../types";
import { summarizeCallProgress } from "./callStatus";
import { useReferenceLinks } from "./useReferenceLinks";

/**
 * The reference's identity-header content (Story 5.10, AC 4) — relocated out
 * of `ReferenceShow.tsx` (deleted in this diff) into its own module, since
 * the shell's `identityHeader` region needs a one-line `{ record }` adapter
 * over it (`entityDescriptorRegions.tsx`'s `ReferenceIdentityHeader`), same
 * class of shim as 5-8's `{ single }` and 5-9's `{ shadchan }`.
 *
 * Keeps ONLY contact-style identity facts (name, avatar) and the
 * conversation-progress meter. The relationship/phone/school/grad-year block
 * that used to live in this header's meta line — along with the note saying
 * relationship can differ per single — moved to the `overview` tab
 * (`ReferenceOverviewTab.tsx`): the shell renders exactly one region for
 * identity, not two copies of the same facts.
 *
 * Exported for direct render coverage (`ReferenceHeader.test.tsx`) — it calls
 * `useTranslate()`/`useReferenceLinks()` (`useGetList`), so it needs a real
 * `ra-core` + data-provider context, not just its own props.
 */
export const ReferenceHeader = ({ reference }: { reference: Reference }) => {
  const translate = useTranslate();
  const { links, isPending: linksPending } = useReferenceLinks(reference.id);
  const progress = summarizeCallProgress(links);
  const name = reference.name_en || "?";
  const meterPct =
    progress.total > 0
      ? Math.round((progress.contacted / progress.total) * 100)
      : 0;

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <EntityAvatar
            seed={reference.name_en ?? String(reference.id)}
            monogramSource={reference.name_en}
            className="h-12 w-12 rounded-xl text-base"
          />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold leading-tight">
              {name}
            </h2>
          </div>
        </div>

        <div className="w-full max-w-[220px] shrink-0 sm:w-[220px]">
          {linksPending ? (
            // Same footprint as the settled meter below (text row + gap +
            // bar), so the header's height never shifts once the count
            // resolves. Without this, `progress.total` is 0 while
            // `useReferenceLinks` is in flight, so the real meter would
            // briefly claim "0 of 0 conversations done" on a reference that
            // has some — the same false-empty state as the RULING 7
            // `RepeatRecognitionPanel` finding, and it comes from the same
            // ignored `isPending`.
            <div aria-busy="true">
              <Skeleton className="ms-auto h-5 w-40" />
              <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
            </div>
          ) : (
            <>
              <p className="text-end text-sm font-medium tabular-nums">
                {translate("crm.references.header.progress", {
                  contacted: progress.contacted,
                  total: progress.total,
                  _: "%{contacted} of %{total} conversations done",
                })}
              </p>
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={meterPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-positive transition-[width] duration-[320ms] ease-[var(--ease-out)]"
                  style={{ width: `${meterPct}%` }}
                />
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

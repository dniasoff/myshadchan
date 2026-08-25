import { useGetList, useTranslate } from "ra-core";
import { PhoneCall } from "lucide-react";

import { Card } from "@/components/ui/card";

import { RecordLink } from "../entity360/RecordLink";
import { CallStatusChip } from "../references/CallStatusChip";
import { getCallStatusDescriptor } from "../references/callStatus";
import type { ReferenceLinkSummary } from "../types";

/**
 * "Still to call" — the account-wide outstanding-conversations worklist.
 *
 * This is the one genuinely load-bearing job the deleted reference book
 * did. Its `contacted_count@eq: 0` filter ("Not yet spoken to") was the only
 * place in the app that answered "across everything I have on, who have I
 * still not got hold of?". RULING 7 closes the book; it does not close that
 * question, so the worklist moves here rather than being dropped.
 *
 * Why the Reminders hub and not the dashboard: `entity360/ad24Conformance.ts`
 * declares `dashboard/**` a browse-surface module, where a list query for a
 * no-browse entity is never legitimate — a tile exists to put records in
 * front of someone who did not ask for them. The Reminders hub is the
 * opposite shape: it is already the account-wide "what still needs doing"
 * surface, and it already deep-links to references (`ReminderCard`), which
 * RULING 7 clause 2 protects as addressability.
 *
 * Why this is not the reference book by another name: it queries
 * `reference_links`, not `references`. Every row IS a conversation inside a
 * named shidduch — the shidduch is on the row and links out — which is
 * precisely the context the ruling requires a reference to be reached from.
 * A reference attached to nothing can never appear here; that class has its
 * own home (`references/ReferencesIndex.tsx`).
 */

/** Bounded — a worklist, not a roster. */
const MAX_SHOWN = 8;
const FETCH_LIMIT = 100;

export const OutstandingCallsSection = () => {
  const translate = useTranslate();
  const { data, isPending } = useGetList<ReferenceLinkSummary>(
    "reference_links",
    {
      pagination: { page: 1, perPage: FETCH_LIMIT },
      sort: { field: "created_at", order: "ASC" },
    },
  );

  // Filtered client-side, like `dashboard/AttentionSection`'s catch_count:
  // "outstanding" is `isContacted === false` over the CALL_STATUS_DESCRIPTORS
  // vocabulary, which lives in TypeScript, not in the view — expressing it as
  // a server-side status list would duplicate that vocabulary in a filter
  // string and drift the first time a status is added.
  const outstanding = (data ?? []).filter(
    (link) =>
      link.shidduchim_id != null &&
      !getCallStatusDescriptor(link.call_status).isContacted,
  );

  if (isPending || outstanding.length === 0) return null;

  const shown = outstanding.slice(0, MAX_SHOWN);
  const overflow = outstanding.length - shown.length;

  return (
    <Card className="flex flex-col gap-3 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full
            bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-primary"
          aria-hidden="true"
        >
          <PhoneCall className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">
            {translate("crm.reminders.outstandingCalls.title", {
              _: "Still to call",
            })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {translate("crm.reminders.outstandingCalls.subtitle", {
              smart_count: outstanding.length,
              _: "%{smart_count} conversations have not happened yet.",
            })}
          </p>
        </div>
      </div>

      <ul className="flex flex-col divide-y">
        {shown.map((link) => (
          <li
            key={String(link.id)}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0">
              <RecordLink
                resource="references"
                id={link.reference_id}
                className="inline-flex min-h-11 items-center text-sm font-medium hover:underline md:min-h-0"
              >
                {link.reference_name_en || "?"}
              </RecordLink>
              <p className="truncate text-xs text-muted-foreground">
                {translate("crm.reminders.outstandingCalls.about", {
                  _: "about",
                })}{" "}
                <RecordLink
                  resource="shidduchim"
                  id={link.shidduchim_id!}
                  className="hover:underline"
                >
                  {link.shidduch_name_en || `#${link.shidduchim_id}`}
                </RecordLink>
                {link.single_first_name_en
                  ? ` · for ${link.single_first_name_en}`
                  : ""}
              </p>
            </div>
            <CallStatusChip status={link.call_status} />
          </li>
        ))}
        {overflow > 0 ? (
          <li className="pt-2 text-xs text-muted-foreground">
            {translate("crm.reminders.outstandingCalls.overflow", {
              smart_count: overflow,
              _: "and %{smart_count} more",
            })}
          </li>
        ) : null}
      </ul>
    </Card>
  );
};

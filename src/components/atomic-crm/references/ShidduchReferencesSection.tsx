import type { Identifier } from "ra-core";
import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { ReferenceLinkSummary } from "../types";
import { CallStatusChip } from "./CallStatusChip";
import { summarizeCallProgress } from "./callStatus";

/**
 * The references section of a shidduch's 360 view (FR38).
 *
 * The same reference_links data as the reference's own page, rendered from the
 * other direction: there, "which singles have I asked this person about"; here,
 * "who have I asked about this single, and how far have I got".
 *
 * Each row links out to the reference's own page, which is where the
 * cross-shidduch history lives. That link is the thing the imported design could
 * not offer, because a reference had no id outside one shidduch's tab.
 */
export const ShidduchReferencesSection = ({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}) => {
  const translate = useTranslate();
  const { data } = useGetList<ReferenceLinkSummary>("reference_links", {
    filter: { shidduchim_id: shidduchimId },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "created_at", order: "ASC" },
  });

  const links = data ?? [];
  const progress = summarizeCallProgress(links);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate("resources.references.name", {
            smart_count: 2,
            _: "References",
          })}
        </h3>
        {links.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {translate("crm.references.header.progress", {
              contacted: progress.contacted,
              total: progress.total,
              _: "%{contacted} of %{total} conversations done",
            })}
          </span>
        ) : null}
      </div>

      {links.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {translate("crm.references.shidduch.empty", {
            _: "Nobody has been asked about this single yet.",
          })}
        </p>
      ) : (
        <ul className="mb-3 flex flex-col divide-y">
          {links.map((link) => (
            <li
              key={String(link.id)}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <Link
                  to={`/references/${link.reference_id}/show`}
                  className="font-medium hover:underline"
                >
                  {link.reference_name_en || link.reference_name_he}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[link.effective_relationship, link.reference_phone]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {link.what_they_said ? (
                  <p className="mt-1 line-clamp-2 text-sm">
                    {link.what_they_said}
                  </p>
                ) : null}
              </div>
              <CallStatusChip status={link.call_status} />
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="outline" className="min-h-[44px]">
        <Link to={`/references/create?shidduchim_id=${shidduchimId}`}>
          {translate("crm.references.shidduch.add", {
            _: "Add a reference",
          })}
        </Link>
      </Button>
    </section>
  );
};

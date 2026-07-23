import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import type { ReferenceLinkSummary } from "../types";
import { CallStatusChip } from "./CallStatusChip";
import { summarizeCallProgress } from "./callStatus";

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
 */
export const RepeatRecognitionPanel = ({
  referenceName,
  links,
  excludeShidduchimId,
  compact = false,
}: {
  referenceName: string;
  links: ReferenceLinkSummary[];
  excludeShidduchimId?: Identifier | null;
  compact?: boolean;
}) => {
  const translate = useTranslate();

  const others = links.filter(
    (link) =>
      link.shidduchim_id != null && link.shidduchim_id !== excludeShidduchimId,
  );

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
                <Link
                  to={`/shidduchim/${link.shidduchim_id}/show`}
                  className="font-medium hover:underline"
                >
                  {link.shidduch_name_en}
                </Link>
                <p className="truncate text-sm text-muted-foreground">
                  {[link.effective_relationship, link.child_first_name_en]
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

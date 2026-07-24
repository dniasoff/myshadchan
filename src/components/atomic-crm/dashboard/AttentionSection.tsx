import { useGetList } from "ra-core";
import { BellRing } from "lucide-react";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import type { ShidduchSummary } from "../types";

/**
 * Honey "to review" section (design-language §5.8): relief, not alarm. E3 wires
 * the real dedupe "catch" feed in — the suggestions that look like someone the
 * family has come across before. When there is nothing to review it keeps the
 * original calm empty state, so the layout never jumps.
 *
 * catch_count rides along on the shidduchim_summary read, so this is one query
 * with no per-row lookup; the >0 filter is applied client-side because FakeRest
 * computes catch_count after the fetch (a server-side filter would miss it),
 * and the number of catches in an account is small.
 */
const MAX_SHOWN = 4;

export const AttentionSection = () => {
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "DESC" },
  });

  const catches = (data ?? []).filter((s) => (s.catch_count ?? 0) > 0);
  const shown = catches.slice(0, MAX_SHOWN);
  const overflow = catches.length - shown.length;

  return (
    <Card
      className="flex flex-col gap-3 border-[color-mix(in_oklch,var(--attention)_35%,transparent)]
        bg-[color-mix(in_oklch,var(--attention)_10%,transparent)] p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full
            bg-[color-mix(in_oklch,var(--attention)_28%,transparent)] text-attention-foreground"
          aria-hidden="true"
        >
          <BellRing className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">
            Needs your attention
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isPending || catches.length === 0
              ? "Nothing to review — you're on top of it."
              : catches.length === 1
                ? "One suggestion looks like someone you've come across before."
                : `${catches.length} suggestions look like people you've come across before.`}
          </p>
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[color-mix(in_oklch,var(--attention)_20%,var(--border))]">
          {shown.map((s) => (
            <li key={String(s.id)} className="py-2">
              <Link
                to={`/shidduchim/${s.id}/show`}
                className="flex flex-wrap items-baseline justify-between gap-2 hover:underline"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {s.name_en ?? s.child_first_name_en ?? "Unnamed"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.child_first_name_en
                    ? `for ${s.child_first_name_en}`
                    : "Suggested before"}
                </span>
              </Link>
            </li>
          ))}
          {overflow > 0 ? (
            <li className="pt-2 text-xs text-muted-foreground">
              and {overflow} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </Card>
  );
};

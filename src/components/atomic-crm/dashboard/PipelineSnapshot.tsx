import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";

import type { ShidduchSummary } from "../types";
import { bucketByState } from "./bucketByState";

export interface PipelineSnapshotProps {
  childId: Identifier;
}

/**
 * The signature "moment" (design-language §4.4/§5.6): a single horizontal
 * bar segmented by the 7 pipeline states, each segment its token colour and
 * width = share of the child's shidduchim, with a tabular-count legend below.
 * Segments grow in once on mount via `.ql-segment`. Never a pie, never 3-D.
 */
export const PipelineSnapshot = ({ childId }: PipelineSnapshotProps) => {
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    filter: { child_id: childId },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "index", order: "ASC" },
  });

  const summaries = data ?? [];
  const total = summaries.length;
  const buckets = bucketByState(summaries);

  return (
    <Card className="p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">
          Pipeline snapshot
        </h2>
        <Link
          to="/shidduchim"
          className="text-sm font-medium text-primary outline-none
            hover:underline focus-visible:ring-2 focus-visible:ring-ring
            focus-visible:ring-offset-2 focus-visible:ring-offset-background
            rounded-sm"
        >
          View pipeline
        </Link>
      </div>

      {isPending ? (
        <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
      ) : total === 0 ? (
        <div className="flex h-3 w-full items-center rounded-full border border-dashed border-border" />
      ) : (
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${total} suggestions across the pipeline`}
        >
          {buckets
            .filter((bucket) => bucket.count > 0)
            .map((bucket, index) => (
              <span
                key={bucket.state}
                className="ql-segment h-full"
                style={{
                  width: `${(bucket.count / total) * 100}%`,
                  backgroundColor: `var(${bucket.token})`,
                  animationDelay: `${index * 40}ms`,
                }}
              />
            ))}
        </div>
      )}

      {total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No suggestions yet.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {buckets.map((bucket) => (
            <li
              key={bucket.state}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(${bucket.token})` }}
                aria-hidden="true"
              />
              <span className="truncate text-muted-foreground">
                {bucket.label}
              </span>
              <span className="ms-auto font-semibold tabular-nums">
                {bucket.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

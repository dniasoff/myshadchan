import type { ReactElement } from "react";
import { useGetList, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Skeleton } from "@/components/ui/skeleton";

import type { Interaction } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";

/**
 * The right rail's "single's input" panel (Story 5.7, AC 1 / AC 2). Reads
 * `interactions` rows the single will eventually write once Epic 6 Story 6.4
 * lands the write path — this is the read-only half only, correctly
 * rendering an empty state until then.
 *
 * Filters on RAW database column names (`target_type` / `target_id` /
 * `kind`), not `UniversalTabProps`'s camelCase shape — this is a bespoke
 * rail panel with a fixed `kind`, not a universal tab mounted through
 * `targetType`/`targetId` props (contract §8 applies to that mount shape
 * only).
 */
const RAIL_PAGE_SIZE = 5;

function SingleInputSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function SingleInputEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.rail.singleInput.empty", {
        _: "Nothing has been shared yet.",
      })}
    </p>
  );
}

function SingleInputError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.rail.singleInput.error", {
        _: "Could not load the single's input.",
      })}
    </p>
  );
}

export function SingleInputPanel({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}): ReactElement {
  const { data, error, isPending } = useGetList<Interaction>("interactions", {
    filter: {
      target_type: "shidduch",
      target_id: shidduchimId,
      kind: "single_input",
      "deleted_at@is": null,
    },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: RAIL_PAGE_SIZE },
  });

  if (isPending) return <SingleInputSkeleton />;
  if (error) return <SingleInputError />;
  if (!data || data.length === 0) return <SingleInputEmpty />;

  return (
    <ul className="flex flex-col gap-2">
      {data.map((interaction) => (
        <li key={String(interaction.id)} className="text-sm">
          <p>{interaction.body}</p>
          <p className="text-xs text-muted-foreground">
            {formatTimelineDate(interaction.created_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

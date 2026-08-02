import { useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { Connection } from "../types";

export interface ConnectionRowProps {
  connection: Connection;
  /** Position in the list, drives the `.ql-enter` stagger delay. */
  index: number;
}

/**
 * The List-mode counterpart to `ConnectionCard` (Story 8.5, mirrors
 * `ShadchanRow.tsx`'s own relationship to `ShadchanCard.tsx`): the same
 * identity/status data, laid out as one compact row.
 */
export const ConnectionRow = ({ connection, index }: ConnectionRowProps) => {
  const translate = useTranslate();
  const isEnded = connection.status === "ended";
  const monogram = getMonogram(connection.household_account_name);
  const avatarIndex = getAvatarIndex(connection.household_account_name);

  return (
    <RecordLink
      resource="connections"
      id={connection.id}
      className="ql-enter block rounded-xl outline-none transition-transform
        duration-[160ms] ease-[var(--ease-spring)] active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="flex-row items-center gap-3 rounded-xl p-3 shadow-sm
          transition-[box-shadow,transform] duration-[160ms]
          ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md"
      >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
          aria-hidden="true"
        >
          {monogram}
        </div>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
          {connection.household_account_name}
        </div>
        <Badge variant={isEnded ? "secondary" : "default"} className="shrink-0">
          {isEnded
            ? translate("crm.connections.status.ended_short", {
                _: "Ended",
              })
            : translate("crm.connections.status.accepted", {
                _: "Accepted",
              })}
        </Badge>
      </Card>
    </RecordLink>
  );
};

import { useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../entity360/avatar";
import { RecordLink } from "../entity360/RecordLink";
import type { Connection } from "../types";

export interface ConnectionCardProps {
  connection: Connection;
  /** Position in the grid, drives the `.ql-enter` stagger delay. */
  index: number;
}

/**
 * One tile of the Connections list (Story 8.5, AC-1/AC-6): the connected
 * household's name and a status chip, `RecordLink`-based like every other
 * entity's own card (`ShadchanCard.tsx`'s identity pattern). Never a
 * household record — just the denormalized `household_account_name` this
 * record already carries.
 */
export const ConnectionCard = ({ connection, index }: ConnectionCardProps) => {
  const translate = useTranslate();
  const isEnded = connection.status === "ended";
  const monogram = getMonogram(connection.household_account_name);
  const avatarIndex = getAvatarIndex(connection.household_account_name);

  return (
    <RecordLink
      resource="connections"
      id={connection.id}
      className="ql-enter block rounded-2xl outline-none transition-transform
        duration-[160ms] ease-[var(--ease-spring)] active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="gap-0 p-4 shadow-sm transition-[box-shadow,transform] duration-[160ms]
          ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
            style={{
              backgroundColor: `var(--avatar-${avatarIndex})`,
              color: "var(--avatar-ink)",
            }}
            aria-hidden="true"
          >
            {monogram}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">
              {connection.household_account_name}
            </div>
          </div>
          <Badge
            variant={isEnded ? "secondary" : "default"}
            className="shrink-0"
          >
            {isEnded
              ? translate("crm.connections.status.ended_short", {
                  _: "Ended",
                })
              : translate("crm.connections.status.accepted", {
                  _: "Accepted",
                })}
          </Badge>
        </div>
      </Card>
    </RecordLink>
  );
};

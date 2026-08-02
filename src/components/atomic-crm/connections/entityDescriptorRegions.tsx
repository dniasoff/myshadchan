import type { ReactNode } from "react";
import { Send } from "lucide-react";
import { useGetList, useRecordContext, useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { DashboardStat } from "../dashboard/DashboardStat";
import { ActivityTab } from "../entity360/tabs/ActivityTab";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import { NotesTab } from "../entity360/tabs/NotesTab";
import { TasksTab } from "../entity360/tabs/TasksTab";
import { EntityAvatar } from "../entity360/EntityAvatar";
import { ThreadList } from "../threads/ThreadList";
import type { Connection } from "../types";
import { ConnectionEndAction } from "./ConnectionEndAction";
import { ConnectionSendRedtAction } from "./ConnectionSendRedtAction";

/**
 * The region/tab adapters `connections/entityDescriptor.tsx` assembles into
 * `connectionsDescriptor` (Story 8.5). Split into their own module because
 * they are React components and `entityDescriptor.tsx`'s other export,
 * `connectionsDescriptor`, is not — `react-refresh/only-export-components`
 * flags a file that mixes the two, exactly like
 * `shadchanim/entityDescriptorRegions.tsx` / `references/entityDescriptorRegions.tsx`.
 */

/**
 * The `identityHeader` region: the connected household's account name (AC-2)
 * — never a `shadchanim`/`accounts` row, only the denormalized snapshot
 * `accept_connection_invite()` already carries on this record — plus a
 * status badge (accepted / ended, with the end date once ended) and a
 * "Connected since" line.
 */
export const ConnectionIdentityHeader = ({
  record,
}: {
  record: Connection;
}) => {
  const translate = useTranslate();
  const isEnded = record.status === "ended";

  return (
    <Card className="gap-3 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar
            seed={record.household_account_name}
            monogramSource={record.household_account_name}
            className="size-10 shrink-0 rounded-xl text-sm"
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">
              {record.household_account_name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {translate("crm.connections.header.connectedSince", {
                _: "Connected since %{date}",
                date: formatTimelineDate(record.created_at),
              })}
            </p>
          </div>
        </div>
        <Badge variant={isEnded ? "secondary" : "default"} className="shrink-0">
          {isEnded
            ? translate("crm.connections.status.ended", {
                _: "Ended %{date}",
                date: record.ended_at
                  ? formatTimelineDate(record.ended_at)
                  : "",
              })
            : translate("crm.connections.status.accepted", {
                _: "Accepted",
              })}
        </Badge>
      </div>
    </Card>
  );
};

/**
 * The `statBand` region (AC-2): the count of redts sent through THIS
 * connection, derived from the connection-scoped `threads` Story 8.3's
 * `redt_via_connection()` mirrors — never from `redts`/`inbox_items`
 * (structurally unreachable to the shadchan, AD-20/Story 8.4).
 *
 * `subject_type = 'relationship'` is the shape `redt_via_connection()`
 * always creates. A manually-started discussion (Task 3's own "Start a
 * discussion" button, reused unchanged from `ThreadList`) creates a thread
 * of the identical shape, so this count is an upper bound on "redts sent"
 * rather than an exact one — the same known limitation Story 8.3's review
 * recorded ("no uniqueness on redt-created threads") and left for a future
 * product decision, not one this story introduces.
 */
export const ConnectionStatBand = ({ record }: { record: Connection }) => {
  const translate = useTranslate();
  // Review fix (M1): reads the query's own `total` (PostgREST's exact
  // Content-Range count) rather than `data.length` at a capped `perPage` —
  // `PrivacySection.tsx`'s own `useGetList(..., { perPage: 1 })` precedent
  // for a pure count. `data` itself is never used here, so `perPage: 1`
  // fetches the minimum the API allows rather than up to 200 rows this
  // component would otherwise discard.
  const { total, isPending } = useGetList("threads", {
    filter: { connection_id: record.id, subject_type: "relationship" },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <DashboardStat
        label={translate("crm.connections.stats.redtsSent", {
          _: "Redts sent",
        })}
        value={isPending ? 0 : (total ?? 0)}
        icon={Send}
      />
    </div>
  );
};

/**
 * The `rightRail` region (AC-4, AC-5): "Send a redt" launches Story 8.3's
 * `RedtComposeDialog`, pre-bound to this connection — disabled with an
 * explanation once the connection has ended. "End connection" is a
 * confirm-and-call action over Story 8.2's `endConnection()`.
 */
export const ConnectionRightRail = ({ record }: { record: Connection }) => (
  <div className="flex flex-col gap-3">
    <ConnectionSendRedtAction connection={record} />
    <ConnectionEndAction connection={record} />
  </div>
);

/**
 * The `discussions` tab (AC-3, Task 3): the connection's threads, reused
 * unchanged from Epic 7's `ThreadList` (the only place a shadchan reaches a
 * thread from, per UX-DR8 — "reached from its parent, not primary
 * navigation"). `connectionId`, never `subjectType`/`subjectId` — a
 * connection-scoped redt thread carries `subject_id = null`, so filtering on
 * subject alone cannot distinguish this connection's threads from another
 * connection's.
 */
export function ConnectionDiscussionsTab(): ReactNode {
  const record = useRecordContext<Connection>();
  if (!record) return null;
  return <ThreadList connectionId={record.id} />;
}

/**
 * `render` is arity-zero (contract §2 rule 4) — these three thin wrappers
 * reach the record via `useRecordContext()` rather than a typed prop,
 * exactly like every other entity's own universal-tab adapters.
 * `targetType`/`targetId`, camelCase — never the DB's `target_type`.
 */
export function ConnectionNotesTab(): ReactNode {
  const record = useRecordContext<Connection>();
  if (!record) return null;
  return <NotesTab targetType="connection" targetId={record.id} />;
}

export function ConnectionTasksTab(): ReactNode {
  const record = useRecordContext<Connection>();
  if (!record) return null;
  return <TasksTab targetType="connection" targetId={record.id} />;
}

export function ConnectionActivityTab(): ReactNode {
  const record = useRecordContext<Connection>();
  if (!record) return null;
  return <ActivityTab targetType="connection" targetId={record.id} />;
}

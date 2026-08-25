import { Handshake, MessageCircle } from "lucide-react";
import type { Identifier } from "ra-core";
import { useGetList, useTranslate } from "ra-core";

import { Card } from "@/components/ui/card";

import { RecordLink } from "../entity360/RecordLink";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import { EmptyState } from "../misc/EmptyState";
import { computeUnreadThreadIds } from "../threads/computeUnreadThreadIds";
import { useCurrentMemberId } from "../threads/useCurrentMemberId";
import type { Connection, Message, Thread, ThreadParticipant } from "../types";
import { DashboardStat } from "./DashboardStat";

const RECENT_LIMIT = 5;

/**
 * "Most recently active first": each connection's own latest connection-
 * scoped message, falling back to the connection's own `created_at` for one
 * with no messages yet (so a brand-new connection still appears, just
 * ordered after every connection with real activity). Not exported (unlike
 * `computeUnreadThreadIds`'s own sibling-file split): this component's own
 * File List is exactly `ShadchanDashboard.tsx`, so a helper of comparable
 * size stays inline rather than in a new module; `react-refresh/only-export-
 * components` is satisfied by keeping it un-exported, and its behaviour is
 * covered by the component-level "orders the recent list…" test below
 * (`ShadchanDashboard.test.tsx`) rather than a direct unit test.
 */
function sortByLatestActivity(
  connections: Connection[],
  threads: Thread[],
  messages: Message[],
): Connection[] {
  const connectionIdByThreadId = new Map<Identifier, Identifier>();
  for (const thread of threads) {
    if (thread.connection_id != null) {
      connectionIdByThreadId.set(thread.id, thread.connection_id);
    }
  }

  const latestActivityAt = new Map<string, number>();
  for (const message of messages) {
    const connectionId = connectionIdByThreadId.get(message.thread_id);
    if (connectionId == null) continue;
    const key = String(connectionId);
    const at = new Date(message.created_at).getTime();
    const current = latestActivityAt.get(key);
    if (current === undefined || at > current) {
      latestActivityAt.set(key, at);
    }
  }

  return [...connections].sort((a, b) => {
    const aAt =
      latestActivityAt.get(String(a.id)) ?? new Date(a.created_at).getTime();
    const bAt =
      latestActivityAt.get(String(b.id)) ?? new Date(b.created_at).getTime();
    return bAt - aAt;
  });
}

/**
 * Story 8.5 (AC-7): replaces Story 8.1's placeholder body with the real
 * shadchanus dashboard — a stat band (accepted-connection count,
 * unread-conversation count per Story 7.5's own unread definition) and a
 * short list of the most recently active connections, each a `RecordLink`
 * (AC-6: no ad-hoc `<Link>`). Zero-connections still renders Story 8.1's
 * exact empty-state copy (Task 6: "reuse the i18n key", not a new one) —
 * this must not regress that story's empty-state behaviour.
 *
 * The unread-conversation computation reuses `computeUnreadThreadIds`
 * (Story 7.5) — the same signal `ThreadList`'s own indicator is built
 * from — rather than inventing a second recency heuristic, scoped across
 * every connection-scoped thread the caller can read (RLS already confines
 * that to their own connections), not one connection at a time.
 *
 * Review fix (M1): the "Connections" stat reads the `connections` query's
 * own `total` (PostgREST's exact Content-Range count) rather than
 * `acceptedConnections.length`, so it stays correct past the 200-row
 * `perPage` cap — `acceptedConnections` (the capped array) is kept only for
 * the empty-state check and the "recently active" slice, which need actual
 * records, not a count. The unread-conversation count and the recent-list
 * ordering still derive from the capped `threads`/`messages` arrays (a
 * per-thread computation `total` cannot substitute for) — a known,
 * documented limit at extreme scale (200+ active threads or 500+ messages
 * across a shadchan's connections), not fixed in this pass.
 */
export const ShadchanDashboard = () => {
  const translate = useTranslate();

  const {
    data: connections,
    total: connectionsTotal,
    isPending: connectionsPending,
  } = useGetList<Connection>("connections", {
    filter: { status: "accepted" },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "created_at", order: "DESC" },
  });

  const { data: threads, isPending: threadsPending } = useGetList<Thread>(
    "threads",
    {
      filter: { "connection_id@not.is": null },
      pagination: { page: 1, perPage: 200 },
      sort: { field: "created_at", order: "DESC" },
    },
  );

  const threadIds = (threads ?? []).map((thread) => thread.id);
  const { data: currentMemberId } = useCurrentMemberId();

  const { data: myParticipation } = useGetList<ThreadParticipant>(
    "thread_participants",
    {
      filter: {
        member_id: currentMemberId,
        "thread_id@in": `(${threadIds.join(",")})`,
      },
      pagination: { page: 1, perPage: threadIds.length || 1 },
    },
    { enabled: threadIds.length > 0 && currentMemberId != null },
  );

  const { data: messages, isPending: messagesPending } = useGetList<Message>(
    "messages",
    {
      filter: { "thread_id@in": `(${threadIds.join(",")})` },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: threadIds.length > 0 },
  );

  const isPending =
    connectionsPending ||
    threadsPending ||
    (threadIds.length > 0 && messagesPending);

  if (isPending) return null;

  const acceptedConnections = connections ?? [];
  const allThreads = threads ?? [];
  const allMessages = messages ?? [];

  const unreadThreadIds = computeUnreadThreadIds(
    allThreads,
    myParticipation ?? [],
    allMessages,
  );
  const unreadConnectionIds = new Set(
    allThreads
      .filter((thread) => unreadThreadIds.has(thread.id))
      .map((thread) => thread.connection_id)
      .filter(
        (connectionId): connectionId is Identifier => connectionId != null,
      )
      .map((connectionId) => String(connectionId)),
  );

  const recentConnections = sortByLatestActivity(
    acceptedConnections,
    allThreads,
    allMessages,
  ).slice(0, RECENT_LIMIT);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.shadchanus_context.eyebrow", { _: "Shadchanus" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em]">
          {translate("crm.shadchan_dashboard.title", {
            _: "Your shadchanus workspace",
          })}
        </h1>
      </div>

      {acceptedConnections.length === 0 ? (
        <EmptyState
          title={translate("crm.shadchan_dashboard.empty_title", {
            _: "Nothing here yet",
          })}
          description={translate("crm.shadchan_dashboard.empty_description", {
            _: "Once you connect with a family, their conversations will appear here.",
          })}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <DashboardStat
              label={translate("crm.shadchan_dashboard.stats.connections", {
                _: "Connections",
              })}
              value={connectionsTotal ?? acceptedConnections.length}
              icon={Handshake}
              to="/connections"
            />
            <DashboardStat
              label={translate("crm.shadchan_dashboard.stats.unread", {
                _: "Unread conversations",
              })}
              value={unreadConnectionIds.size}
              icon={MessageCircle}
            />
          </div>

          <Card className="p-5 shadow-sm">
            <h2 className="mb-4 font-display text-lg font-semibold">
              {translate("crm.shadchan_dashboard.recent_title", {
                _: "Recently active connections",
              })}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {recentConnections.map((connection, index) => (
                <li
                  key={connection.id}
                  className="ql-enter"
                  style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                >
                  <RecordLink
                    resource="connections"
                    id={connection.id}
                    className="flex items-center justify-between gap-3 rounded-xl
                      border border-transparent p-3 outline-none
                      transition-colors duration-[160ms]
                      hover:border-border hover:bg-secondary
                      focus-visible:ring-2 focus-visible:ring-ring
                      focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold leading-tight">
                        {connection.household_account_name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {translate("crm.shadchan_dashboard.connectedSince", {
                          _: "Connected since %{date}",
                          date: formatTimelineDate(connection.created_at),
                        })}
                      </div>
                    </div>
                    {unreadConnectionIds.has(String(connection.id)) ? (
                      <>
                        {/* The dot stays decorative, but "has unread
                         * messages" cannot be carried by an 8px colour alone
                         * — this is the text equivalent for screen readers. */}
                        <span
                          className="me-1 inline-block size-2 shrink-0 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <span className="sr-only">
                          {translate("crm.shadchan_dashboard.has_unread", {
                            _: "Unread messages",
                          })}
                        </span>
                      </>
                    ) : null}
                  </RecordLink>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
};

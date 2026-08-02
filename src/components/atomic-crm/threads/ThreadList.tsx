import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";
import type {
  Message,
  Thread,
  ThreadParticipant,
  ThreadSubjectType,
} from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import { computeUnreadThreadIds } from "./computeUnreadThreadIds";
import { ThreadPanel } from "./ThreadPanel";
import { useCurrentMemberId } from "./useCurrentMemberId";

/**
 * Story 7.1 (AC-1, AC-2, AC-7) — threads for one subject. Reusable across
 * both `ThreadSubjectType`s, though only `shidduchim/ShidduchDiscussionsTab`
 * wires it in this story (a `relationship` thread has no surface yet — see
 * this story's Task 8, "do not build a bespoke tab shell"). Lists every
 * thread the caller's `thread_is_readable()` admits and renders the
 * selected one's `ThreadPanel` alongside it.
 */
export interface ThreadListProps {
  subjectType: ThreadSubjectType;
  subjectId: Identifier;
}

function ThreadListSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function ThreadListEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.threads.list.empty", { _: "No discussions yet." })}
    </p>
  );
}

function ThreadListError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.threads.list.error", {
        _: "Could not load the discussions.",
      })}
    </p>
  );
}

function ThreadRow({
  thread,
  isSelected,
  isUnread,
  onSelect,
}: {
  thread: Thread;
  isSelected: boolean;
  isUnread: boolean;
  onSelect: () => void;
}): ReactElement {
  const translate = useTranslate();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={`w-full rounded-md border px-3 py-2 text-start text-sm transition-colors ${
          isSelected
            ? "border-primary bg-accent"
            : "border-border hover:bg-accent/50"
        }`}
      >
        {isUnread ? (
          <span
            className="me-2 inline-block size-2 rounded-full bg-primary align-middle"
            aria-hidden="true"
          />
        ) : null}
        <span className={isUnread ? "font-semibold" : "font-medium"}>
          {thread.visibility === "private"
            ? translate("crm.threads.list.rowPrivate", { _: "Private" })
            : translate("crm.threads.list.rowOpen", { _: "Open" })}
        </span>
        <span className="ms-2 text-xs text-muted-foreground">
          {formatTimelineDate(thread.created_at)}
        </span>
        {isUnread ? (
          <span className="sr-only">
            {translate("crm.threads.list.unread", { _: "Unread" })}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function ThreadList({
  subjectType,
  subjectId,
}: ThreadListProps): ReactNode {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [selectedId, setSelectedId] = useState<Identifier | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const { data, error, isPending } = useGetList<Thread>("threads", {
    filter: { subject_type: subjectType, subject_id: subjectId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 20 },
  });

  // Story 7.5 (AC-1): the two extra reads the unread indicator needs — the
  // caller's OWN thread_participants rows (for last_read_at) and this
  // subject's messages (for each thread's latest created_at) — fired only
  // once the thread ids are known, and skipped entirely while the list is
  // empty rather than issuing an "id@in ()" request that matches nothing.
  const threadIds = (data ?? []).map((thread) => thread.id);
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

  const { data: recentMessages } = useGetList<Message>(
    "messages",
    {
      filter: { "thread_id@in": `(${threadIds.join(",")})` },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 200 },
    },
    { enabled: threadIds.length > 0 },
  );

  const unreadThreadIds = computeUnreadThreadIds(
    data ?? [],
    myParticipation ?? [],
    recentMessages ?? [],
  );

  const activeId = selectedId ?? data?.[0]?.id ?? null;
  // Story 7.3 (Task 4): the FULL thread record, not just its id — ThreadPanel
  // needs `visibility` to render its lock control, and this list already
  // has it loaded (no second `getOne("threads", …)` round trip inside the
  // panel).
  const activeThread =
    data?.find((thread) => String(thread.id) === String(activeId)) ?? null;

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const thread = await dataProvider.createThread({
        subject_type: subjectType,
        subject_id: subjectId,
      });
      setSelectedId(thread.id);
      refresh();
    } catch (startError) {
      notify(
        startError instanceof Error
          ? startError.message
          : translate("crm.threads.list.startError", {
              _: "Failed to start the discussion",
            }),
        { type: "error" },
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex flex-col gap-2 md:w-64 md:shrink-0">
        <Button
          type="button"
          variant="secondary"
          disabled={isStarting}
          onClick={handleStart}
        >
          {translate("crm.threads.list.start", { _: "Start a discussion" })}
        </Button>
        {isPending ? (
          <ThreadListSkeleton />
        ) : error ? (
          <ThreadListError />
        ) : !data || data.length === 0 ? (
          <ThreadListEmpty />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((thread) => (
              <ThreadRow
                key={String(thread.id)}
                thread={thread}
                isSelected={String(thread.id) === String(activeId)}
                isUnread={unreadThreadIds.has(thread.id)}
                onSelect={() => setSelectedId(thread.id)}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {activeThread != null ? <ThreadPanel thread={activeThread} /> : null}
      </div>
    </div>
  );
}

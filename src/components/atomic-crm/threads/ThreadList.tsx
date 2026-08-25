import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
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
  CreateThreadInput,
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
 * both `ThreadSubjectType`s, and — since Story 8.5 (Task 3) — across the
 * connection axis too. Lists every thread the caller's `thread_is_readable()`
 * admits and renders the selected one's `ThreadPanel` alongside it.
 *
 * Story 8.5 widens this to an XOR shape (mirroring `threads`' own
 * account_id/connection_id XOR, AD-1): either a subject
 * (`subjectType`/`subjectId`, `shidduchim/ShidduchDiscussionsTab`'s shape)
 * or a `connectionId` (the Connection 360's `discussions` tab,
 * `connections/entityDescriptorRegions.tsx`'s `ConnectionDiscussionsTab`) —
 * never both. A `subject_id`-only filter cannot distinguish two different
 * connections' redt threads: `redt_via_connection()` always creates
 * `subject_type = 'relationship', subject_id = null`, so a shadchan with two
 * connections would have two such threads sharing the identical
 * `(subject_type, subject_id)` pair, differing only in `connection_id`.
 */
export type ThreadListProps =
  | {
      subjectType: ThreadSubjectType;
      subjectId: Identifier;
      connectionId?: undefined;
    }
  | {
      connectionId: Identifier;
      subjectType?: undefined;
      subjectId?: undefined;
    };

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

/**
 * One thread in the list. The row's TITLE is what was last said in it — a
 * household with several discussions was previously shown a stack of rows
 * whose entire title was the privacy setting ("Private" / "Private" /
 * "Open") plus a date, which identifies nothing. Privacy stays, demoted to
 * an icon plus its own word on a muted second line: it is a real property of
 * the thread, and dropping the word for an icon alone would take the label
 * away from screen readers and retire two live catalogue keys.
 */
function ThreadRow({
  thread,
  isSelected,
  isUnread,
  preview,
  onSelect,
}: {
  thread: Thread;
  isSelected: boolean;
  isUnread: boolean;
  preview: string | null;
  onSelect: () => void;
}): ReactElement {
  const translate = useTranslate();
  const isPrivate = thread.visibility === "private";
  const PrivacyIcon = isPrivate ? Lock : Unlock;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={`flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-start text-sm transition-colors ${
          isSelected
            ? "border-primary bg-accent"
            : "border-border hover:bg-accent/50"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isUnread ? (
            <span
              className="inline-block size-2 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
          <span
            className={`line-clamp-1 ${isUnread ? "font-semibold" : "font-medium"}`}
          >
            {preview ??
              translate("crm.threads.list.rowNoMessages", {
                _: "Nothing said yet",
              })}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PrivacyIcon className="size-3 shrink-0" aria-hidden="true" />
          <span>
            {isPrivate
              ? translate("crm.threads.list.rowPrivate", { _: "Private" })
              : translate("crm.threads.list.rowOpen", { _: "Open" })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatTimelineDate(thread.created_at)}</span>
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

/**
 * The `useGetList("threads", …)` filter for either branch of the XOR shape
 * above. A plain function (not inlined) so TS narrows `props` by direct
 * property access on the parameter itself — the reliable form of
 * discriminated-union narrowing, rather than depending on aliasing a
 * destructured local.
 */
function threadListFilter(
  props: ThreadListProps,
):
  | { connection_id: Identifier }
  | { subject_type: ThreadSubjectType; subject_id: Identifier } {
  if (props.connectionId != null) {
    return { connection_id: props.connectionId };
  }
  return { subject_type: props.subjectType, subject_id: props.subjectId };
}

/** The `createThread()` input for either branch — a connection-scoped
 * "Start a discussion" always creates a `relationship` thread with no
 * subject_id, the same shape `redt_via_connection()` itself creates
 * (`threads_subject_id_check`'s pairing). */
function threadListCreateInput(props: ThreadListProps): CreateThreadInput {
  if (props.connectionId != null) {
    return { subject_type: "relationship", connection_id: props.connectionId };
  }
  return { subject_type: props.subjectType, subject_id: props.subjectId };
}

export function ThreadList(props: ThreadListProps): ReactNode {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [selectedId, setSelectedId] = useState<Identifier | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const { data, error, isPending } = useGetList<Thread>("threads", {
    filter: threadListFilter(props),
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

  // The row-title preview, from the messages ALREADY fetched above for the
  // unread derivation — no extra round trip. That query is sorted
  // created_at DESC, so the first row seen for a thread is its latest.
  // It shares that query's `perPage: 200` ceiling across all 20 threads:
  // past it a thread falls back to the "nothing said yet" label rather than
  // showing a stale preview, which is the safe direction to be wrong in.
  const latestBodyByThreadId = new Map<string, string>();
  for (const message of recentMessages ?? []) {
    const key = String(message.thread_id);
    if (!latestBodyByThreadId.has(key)) {
      latestBodyByThreadId.set(key, message.body);
    }
  }

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
      const thread = await dataProvider.createThread(
        threadListCreateInput(props),
      );
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
                preview={latestBodyByThreadId.get(String(thread.id)) ?? null}
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

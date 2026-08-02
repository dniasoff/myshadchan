import { useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
import {
  useCreate,
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../providers/types";
import type { Message, Thread, ThreadParticipant } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import { useCurrentMemberId } from "./useCurrentMemberId";

/**
 * Story 7.1 (AC-4, AC-8) — the messages half of the Discussions tab. Reads
 * `messages` filtered to one thread; a plain `dataProvider.create("messages",
 * { thread_id, body })` needs no wrapper (contract-equivalent to
 * ExternalLinksTab's / NotesTab's own `useCreate()` shape) — the backend's
 * `set_message_defaults()` trigger stamps `account_id`/`connection_id`/
 * `sender_member_id`, and the participant-gated INSERT policy is what
 * actually enforces AC-8; a denied post surfaces through `useNotify()`
 * exactly like every other tab's write path in this codebase.
 *
 * Review note (F7): Task 8 describes this as "a participant-gated
 * composer." `<Composer>` below renders unconditionally for every viewer
 * who can read the thread, including a non-participant on an `open`
 * thread — AC-8's gate is enforced SERVER-SIDE only, via the RLS `with
 * check` above, with a denied attempt surfaced through `useNotify()`.
 * Deliberately NOT hidden client-side: there is no existing primitive in
 * this codebase for resolving "my own `account_members.id` in the active
 * context" outside a database round trip (`current_member_id()`'s own
 * body is that query) — `useGetIdentity()`/`getIdentity().id` resolves the
 * global `members.id` row, a DIFFERENT id space entirely
 * (`entity360/useViewerRole.ts`'s Dev Notes document exactly this trap for
 * role resolution; the same trap applies to id resolution here). Every
 * other write surface in this codebase relies on this same
 * deny-then-notify pattern rather than a bespoke client-side ownership
 * check, and building a NEW "who am I" mechanism just for this composer
 * risks shipping a second, subtly-wrong identity resolver. If Story 7.5
 * introduces a real "my membership row" concept (it already needs one for
 * `last_read_at`), this composer should switch to pre-emptively disabling
 * itself for a confirmed non-participant using that same mechanism.
 *
 * Story 7.3 (Task 4): unlike the Composer above, the privacy control DOES
 * gate itself client-side — a non-participant on an `open` thread must
 * never be offered a control `set_thread_visibility()` will refuse. Takes
 * the whole `Thread` record (not just its id) so `visibility` is read from
 * `ThreadList.tsx`'s ALREADY-loaded list rather than a second
 * `getOne("threads", …)` round trip here; only the participant roster
 * (`thread_participants`) and the caller's own member id
 * (`useCurrentMemberId`, cached across every panel in the session) are
 * fetched fresh.
 */
export interface ThreadPanelProps {
  thread: Thread;
}

function MessagesSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

function MessagesEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.threads.panel.empty", { _: "No messages yet." })}
    </p>
  );
}

function MessagesError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.threads.panel.error", {
        _: "Could not load the messages.",
      })}
    </p>
  );
}

function MessageRow({ message }: { message: Message }): ReactElement {
  return (
    <li className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0">
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatTimelineDate(message.created_at)}
      </span>
      <p className="whitespace-pre-line text-sm">{message.body}</p>
    </li>
  );
}

function Composer({
  threadId,
  onSent,
}: {
  threadId: Identifier;
  onSent: () => void;
}): ReactElement {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const translate = useTranslate();
  const [body, setBody] = useState("");

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
  };

  const handleSend = async () => {
    const text = body.trim();
    if (text === "") return;
    try {
      await create(
        "messages",
        { data: { thread_id: threadId, body: text } },
        { returnPromise: true },
      );
      setBody("");
      onSent();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.threads.panel.sendError", {
              _: "Failed to send the message",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={2}
        onChange={handleChange}
        placeholder={translate("crm.threads.panel.placeholder", {
          _: "Write a message…",
        })}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || body.trim() === ""}
          onClick={handleSend}
        >
          {translate("crm.threads.panel.send", { _: "Send" })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Story 7.3 (Task 4): the lock/unlock control. Renders nothing at all —
 * not even disabled — for a non-participant: on a `private` thread they
 * cannot reach this component in the first place (the thread itself is
 * unreadable, AC-3), and on an `open` thread a non-participant must not be
 * OFFERED a control `set_thread_visibility()` will refuse (Task 4). While
 * participation is still resolving, this also renders nothing — fail
 * closed, the same posture the dignity-floor gates elsewhere in this
 * codebase take, rather than briefly flashing a control that then
 * disappears.
 */
function VisibilityControl({
  thread,
  isParticipant,
  onChanged,
}: {
  thread: Thread;
  isParticipant: boolean;
  onChanged: () => void;
}): ReactElement | null {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [isSaving, setIsSaving] = useState(false);

  if (!isParticipant) {
    return null;
  }

  const isPrivate = thread.visibility === "private";

  const handleToggle = async () => {
    setIsSaving(true);
    try {
      await dataProvider.setThreadVisibility(
        thread.id,
        isPrivate ? "open" : "private",
      );
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.threads.visibility.updateError", {
              _: "Failed to update this discussion's privacy",
            }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {isPrivate
          ? translate("crm.threads.visibility.unlockDescription", {
              _: "Everyone in the household who can already see this discussion's topic will be able to read it.",
            })
          : translate("crm.threads.visibility.lockDescription", {
              _: "Only the people in this discussion will be able to see it — invisible to the rest of the household.",
            })}
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSaving}
          onClick={handleToggle}
        >
          {isPrivate ? (
            <Unlock className="me-2 size-4" aria-hidden="true" />
          ) : (
            <Lock className="me-2 size-4" aria-hidden="true" />
          )}
          {isPrivate
            ? translate("crm.threads.visibility.unlock", { _: "Make open" })
            : translate("crm.threads.visibility.lock", {
                _: "Make private",
              })}
        </Button>
      </div>
    </div>
  );
}

export function ThreadPanel({ thread }: ThreadPanelProps): ReactNode {
  const threadId = thread.id;
  const refresh = useRefresh();
  const { data, error, isPending } = useGetList<Message>("messages", {
    filter: { thread_id: threadId },
    sort: { field: "created_at", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });

  // Story 7.3 (Task 4): the thread's own participant roster — already
  // needed to render the lock control, and reused (rather than re-fetched)
  // for that sole purpose. `useCurrentMemberId` is the ONE piece of
  // identity this panel cannot derive from data already on the page (see
  // that hook's own comment); both queries run in parallel, not one after
  // the other.
  const { data: participants, isPending: participantsPending } =
    useGetList<ThreadParticipant>("thread_participants", {
      filter: { thread_id: threadId },
      sort: { field: "id", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
    });
  const { data: currentMemberId, isPending: currentMemberIdPending } =
    useCurrentMemberId();

  const isParticipant =
    !participantsPending &&
    !currentMemberIdPending &&
    currentMemberId != null &&
    (participants ?? []).some(
      (participant) =>
        String(participant.member_id) === String(currentMemberId),
    );

  return (
    <div className="flex flex-col gap-4">
      <VisibilityControl
        thread={thread}
        isParticipant={isParticipant}
        onChanged={refresh}
      />
      {isPending ? (
        <MessagesSkeleton />
      ) : error ? (
        <MessagesError />
      ) : !data || data.length === 0 ? (
        <MessagesEmpty />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((message) => (
            <MessageRow key={String(message.id)} message={message} />
          ))}
        </ul>
      )}
      <Composer threadId={threadId} onSent={refresh} />
    </div>
  );
}

import { useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import {
  useCreate,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import type { Message } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";

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
 */
export interface ThreadPanelProps {
  threadId: Identifier;
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

export function ThreadPanel({ threadId }: ThreadPanelProps): ReactNode {
  const refresh = useRefresh();
  const { data, error, isPending } = useGetList<Message>("messages", {
    filter: { thread_id: threadId },
    sort: { field: "created_at", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });

  return (
    <div className="flex flex-col gap-4">
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

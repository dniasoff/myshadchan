import type { Identifier } from "ra-core";

import type { Message, Thread, ThreadParticipant } from "../types";

/**
 * Story 7.5 (AC-1): "unread" is derived, never queued (Dev Notes, "Why
 * in-app delivery needs no queue") — a thread is unread for the caller when
 * some message in it postdates their OWN thread_participants.last_read_at.
 * `last_read_at` null means "never opened" (coalesced to -infinity here,
 * exactly like the database predicate this mirrors), so any message at all
 * makes an un-opened thread read as unread.
 *
 * A pure function in its own file, not inlined into ThreadList.tsx — a
 * function exported alongside components trips
 * `react-refresh/only-export-components`, and it is unit-testable this way
 * without a render, the same split `resumeSharePayload.ts` uses next to
 * `ForwardResumeButton.tsx` for its own payload-shape logic.
 */
export function computeUnreadThreadIds(
  threads: Thread[],
  myParticipation: ThreadParticipant[],
  recentMessages: Message[],
): Set<Identifier> {
  const lastReadByThread = new Map(
    myParticipation.map((participant) => [
      String(participant.thread_id),
      participant.last_read_at ?? null,
    ]),
  );

  const latestMessageByThread = new Map<string, string>();
  for (const message of recentMessages) {
    const key = String(message.thread_id);
    const current = latestMessageByThread.get(key);
    if (current === undefined || message.created_at > current) {
      latestMessageByThread.set(key, message.created_at);
    }
  }

  const unread = new Set<Identifier>();
  for (const thread of threads) {
    const latestMessage = latestMessageByThread.get(String(thread.id));
    if (!latestMessage) continue;
    const lastRead = lastReadByThread.get(String(thread.id));
    if (!lastRead || latestMessage > lastRead) {
      unread.add(thread.id);
    }
  }
  return unread;
}

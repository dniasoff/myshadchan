import type { DataProvider, Identifier } from "ra-core";

import type {
  AccountMember,
  CreateThreadInput,
  Message,
  Thread,
  ThreadParticipant,
  ThreadSubjectType,
  ThreadVisibility,
} from "../../../types";
import {
  resolveContextMembership,
  type GetIdentity,
} from "./accountMemberships";

const THREAD_SUBJECT_TYPES: readonly ThreadSubjectType[] = [
  "shidduch",
  "relationship",
];
const THREAD_VISIBILITIES: readonly ThreadVisibility[] = ["open", "private"];

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

/**
 * FakeRest mirror of `public.create_thread()` (Story 7.1). Account-scoped
 * only — the connection axis (`p_connection_id`) is Story 7.4's, mirroring
 * the real RPC's own scope until then. Every predicate below is copied from
 * the SQL function's own validation, in the same order: subject_type, the
 * subject's account membership, visibility, then one thread_participants
 * row per distinct supplied id, raising on the first one that is not an
 * active member of the caller's own account.
 */
export async function createThread(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  input: CreateThreadInput,
): Promise<Thread> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("createThread requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error("no active membership for create_thread");
  }
  if (!THREAD_SUBJECT_TYPES.includes(input.subject_type)) {
    throw new Error(`invalid thread subject_type: ${input.subject_type}`);
  }

  // Never cross the account boundary (AD-1): the subject shidduch must
  // belong to the caller's account, and must actually exist.
  if (input.subject_type === "shidduch") {
    const { data: matches } = await baseDataProvider.getList("shidduchim", {
      filter: { id: input.subject_id, account_id: membership.account_id },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    });
    if (matches.length === 0) {
      throw new Error(
        `shidduch ${input.subject_id} not found in current account`,
      );
    }
  }

  const visibility: ThreadVisibility = input.visibility ?? "open";
  if (!THREAD_VISIBILITIES.includes(visibility)) {
    throw new Error(`invalid thread visibility: ${visibility}`);
  }

  const now = new Date().toISOString();
  const { data: thread } = await baseDataProvider.create<Thread>("threads", {
    data: {
      account_id: membership.account_id,
      connection_id: null,
      subject_type: input.subject_type,
      subject_id: input.subject_type === "shidduch" ? input.subject_id : null,
      visibility,
      created_by_member_id: membership.id,
      created_at: now,
    },
  });

  // The creator is always a participant, from the moment the thread exists
  // (AC-2). Distinct ids only (a Set absorbs the caller's own id repeated,
  // or a duplicate in the supplied array) — mirrors create_thread()'s own
  // ON CONFLICT DO NOTHING.
  const participantIds = new Set<Identifier>([
    membership.id,
    ...(input.participant_member_ids ?? []),
  ]);

  for (const memberId of participantIds) {
    if (String(memberId) !== String(membership.id)) {
      const { data: candidates } =
        await baseDataProvider.getList<AccountMember>("account_members", {
          filter: {
            id: memberId,
            account_id: membership.account_id,
            status: "active",
          },
          pagination: PAGE_ONE,
          sort: SORT_BY_ID,
        });
      if (candidates.length === 0) {
        throw new Error(`member ${memberId} not found in current account`);
      }
    }
    await baseDataProvider.create("thread_participants", {
      data: {
        account_id: membership.account_id,
        connection_id: null,
        thread_id: thread.id,
        member_id: memberId,
        created_at: now,
      },
    });
  }

  return thread;
}

/** Shared "is this caller listed on this thread" check — the FakeRest
 * mirror of the `exists (select 1 from thread_participants …)` clause
 * inside both the messages and thread_participants INSERT policies. */
async function isThreadParticipant(
  baseDataProvider: DataProvider,
  threadId: Identifier,
  memberId: Identifier,
): Promise<boolean> {
  const { data } = await baseDataProvider.getList("thread_participants", {
    filter: { thread_id: threadId, member_id: memberId },
    pagination: PAGE_ONE,
    sort: SORT_BY_ID,
  });
  return data.length > 0;
}

/**
 * FakeRest mirror of `set_message_defaults()` plus the messages INSERT
 * policy (Story 7.1, AC-4, AC-8). Used by `dataProvider.ts`'s `create()`
 * override so a raw `dataProvider.create("messages", …)` — the ThreadPanel
 * composer's own call shape — gets the same server-stamped
 * account_id/connection_id/sender_member_id the real backend's trigger
 * copies from the parent thread, and the same participant gate, rather than
 * landing an unattributed, unscoped row or silently bypassing AC-8.
 */
export async function createMessage(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  data: { thread_id: Identifier; body?: string | null },
): Promise<Message> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("posting a message requires a signed-in user");
  }
  // Mirrors messages_body_not_blank_check (btrim(body) <> '').
  if (data.body == null || data.body.trim() === "") {
    throw new Error("a message body cannot be blank");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error("no active membership to post a message");
  }

  const { data: thread } = await baseDataProvider.getOne<Thread>("threads", {
    id: data.thread_id,
  });
  if (!thread || String(thread.account_id) !== String(membership.account_id)) {
    throw new Error(`thread ${data.thread_id} not found in current account`);
  }

  // AC-8: participant-gated regardless of the thread's visibility — the
  // same authority thread_participants' own INSERT policy uses.
  if (
    !(await isThreadParticipant(
      baseDataProvider,
      data.thread_id,
      membership.id,
    ))
  ) {
    throw new Error(
      "only a listed participant of this thread may post a message",
    );
  }

  const { data: message } = await baseDataProvider.create<Message>("messages", {
    data: {
      account_id: thread.account_id ?? null,
      connection_id: thread.connection_id ?? null,
      thread_id: data.thread_id,
      sender_member_id: membership.id,
      body: data.body,
      created_at: new Date().toISOString(),
    },
  });
  return message;
}

/**
 * FakeRest mirror of `set_thread_participant_defaults()` plus the
 * thread_participants INSERT policy (Story 7.1, AC-2, AC-8). No built UI
 * calls this directly today (create_thread() seeds every participant row
 * this story's SPA needs) — kept as defense-in-depth parity, exactly like
 * the real INSERT policy it mirrors (Dev Notes, "Why the INSERT policy
 * still matters").
 */
export async function createThreadParticipant(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  data: { thread_id: Identifier; member_id: Identifier },
): Promise<ThreadParticipant> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("adding a participant requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error("no active membership to add a participant");
  }

  const { data: thread } = await baseDataProvider.getOne<Thread>("threads", {
    id: data.thread_id,
  });
  if (!thread || String(thread.account_id) !== String(membership.account_id)) {
    throw new Error(`thread ${data.thread_id} not found in current account`);
  }

  // AC-8: only an EXISTING participant may add a new one — a same-account
  // member can never add THEMSELVES to a conversation they are not in.
  if (
    !(await isThreadParticipant(
      baseDataProvider,
      data.thread_id,
      membership.id,
    ))
  ) {
    throw new Error(
      "only an existing participant may add someone to this thread",
    );
  }

  const { data: participant } =
    await baseDataProvider.create<ThreadParticipant>("thread_participants", {
      data: {
        account_id: thread.account_id ?? null,
        connection_id: thread.connection_id ?? null,
        thread_id: data.thread_id,
        member_id: data.member_id,
        created_at: new Date().toISOString(),
      },
    });
  return participant;
}

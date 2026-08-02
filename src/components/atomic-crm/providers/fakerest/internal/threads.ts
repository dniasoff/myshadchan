import type { DataProvider, Identifier } from "ra-core";

import type {
  AccountMember,
  Connection,
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
 * FakeRest mirror of `public.connection_is_active_for_caller()` (Story 7.4,
 * Task 1) — the one predicate `createThread`, `createMessage`,
 * `createThreadParticipant` and `setThreadVisibility` below all share,
 * mirroring the real SQL function being written once and called from every
 * write path that needs it rather than re-derived per caller.
 */
async function isConnectionActiveForAccount(
  baseDataProvider: DataProvider,
  connectionId: Identifier,
  accountId: Identifier,
): Promise<boolean> {
  const { data: connections } = await baseDataProvider.getList<Connection>(
    "connections",
    {
      filter: { id: connectionId, status: "accepted" },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    },
  );
  const connection = connections[0];
  if (!connection) {
    return false;
  }
  return (
    String(connection.household_account_id) === String(accountId) ||
    String(connection.shadchanus_account_id) === String(accountId)
  );
}

/**
 * FakeRest mirror of `thread_is_readable()`'s SCOPE GATE only (Story 7.4,
 * Task 2) — not the full open/private/dignity-floor resolution. The write
 * paths below (`createMessage`, `createThreadParticipant`,
 * `setThreadVisibility`) approximate the real RPCs' readability requirement
 * with "found in the caller's scope" plus their own participant check, the
 * same narrow parity the account-only version already used before this axis
 * existed (Task 6's own note: this is defense-in-depth parity, not a
 * reimplementation of the full SQL authority).
 */
async function isThreadInCallersScope(
  baseDataProvider: DataProvider,
  thread: Thread,
  membership: AccountMember,
): Promise<boolean> {
  if (thread.account_id != null) {
    return String(thread.account_id) === String(membership.account_id);
  }
  if (thread.connection_id == null) {
    return false;
  }
  return isConnectionActiveForAccount(
    baseDataProvider,
    thread.connection_id,
    membership.account_id,
  );
}

/**
 * FakeRest mirror of `public.create_thread()` (Story 7.1, Story 7.4). Every
 * predicate below is copied from the SQL function's own validation, in the
 * same order: scope resolution, subject_type, the subject's household
 * membership, visibility, then one thread_participants row per distinct
 * supplied id, raising on the first one that is not legal for this thread's
 * axis.
 *
 * Story 7.4 (AC-1, AC-2, AC-3, AC-7): when `input.connection_id` is
 * supplied, the caller's active context must be one side of that connection
 * (`isConnectionActiveForAccount` above) — the thread is created
 * connection-scoped (`account_id` null) and the subject/participant/
 * default-posture resolution all switch to the connection's HOUSEHOLD side,
 * exactly like `create_thread()`'s own `v_household_account_id`. Omitting it
 * is the unchanged 7.1 account-scoped path.
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

  let accountId: Identifier | null = membership.account_id;
  let connectionId: Identifier | null = null;
  let householdAccountId: Identifier | null = null;
  let shadchanusAccountId: Identifier | null = null;

  if (input.connection_id != null) {
    const isActive = await isConnectionActiveForAccount(
      baseDataProvider,
      input.connection_id,
      membership.account_id,
    );
    if (!isActive) {
      throw new Error(
        `connection ${input.connection_id} is not active for the current context`,
      );
    }
    const { data: connection } = await baseDataProvider.getOne<Connection>(
      "connections",
      { id: input.connection_id },
    );
    connectionId = input.connection_id;
    accountId = null;
    householdAccountId = connection.household_account_id;
    shadchanusAccountId = connection.shadchanus_account_id;
  }

  if (!THREAD_SUBJECT_TYPES.includes(input.subject_type)) {
    throw new Error(`invalid thread subject_type: ${input.subject_type}`);
  }

  // Never cross the account boundary (AD-1): the subject shidduch must
  // belong to the RELEVANT household — the caller's own account on the
  // account axis, the connection's household side on the connection axis
  // (AC-2/AD-4) — and must actually exist.
  if (input.subject_type === "shidduch") {
    const { data: matches } = await baseDataProvider.getList("shidduchim", {
      filter: {
        id: input.subject_id,
        account_id: householdAccountId ?? accountId,
      },
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
      account_id: accountId,
      connection_id: connectionId,
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
      if (connectionId != null) {
        // AC-3: legal if it is an ACTIVE account_members row of EITHER side
        // of the connection — cross-side participants are the whole point.
        const { data: candidates } =
          await baseDataProvider.getList<AccountMember>("account_members", {
            filter: { id: memberId, status: "active" },
            pagination: PAGE_ONE,
            sort: SORT_BY_ID,
          });
        const candidate = candidates[0];
        const isEitherSide =
          candidate != null &&
          (String(candidate.account_id) === String(householdAccountId) ||
            String(candidate.account_id) === String(shadchanusAccountId));
        if (!isEitherSide) {
          throw new Error(
            `member ${memberId} not found in either side of this connection`,
          );
        }
      } else {
        const { data: candidates } =
          await baseDataProvider.getList<AccountMember>("account_members", {
            filter: {
              id: memberId,
              account_id: accountId,
              status: "active",
            },
            pagination: PAGE_ONE,
            sort: SORT_BY_ID,
          });
        if (candidates.length === 0) {
          throw new Error(`member ${memberId} not found in current account`);
        }
      }
    }
    await baseDataProvider.create("thread_participants", {
      data: {
        account_id: accountId,
        connection_id: connectionId,
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
 * inside both the messages and thread_participants INSERT policies.
 * Exported: `setThreadVisibility` below (Story 7.3) reuses it rather than
 * re-deriving the same predicate a third way. */
export async function isThreadParticipant(
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
 * policy (Story 7.1, AC-4, AC-8; Story 7.4, AC-6). Used by `dataProvider.ts`'s
 * `create()` override so a raw `dataProvider.create("messages", …)` — the
 * ThreadPanel composer's own call shape — gets the same server-stamped
 * account_id/connection_id/sender_member_id the real backend's trigger
 * copies from the parent thread, and the same participant gate, rather than
 * landing an unattributed, unscoped row or silently bypassing AC-8. AC-6:
 * this is the demo-build parity for the real falsifiable test — a
 * connection-scoped thread's participant can post through this exact call
 * shape once `isThreadInCallersScope` admits the axis.
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
  if (
    !thread ||
    !(await isThreadInCallersScope(baseDataProvider, thread, membership))
  ) {
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
  if (
    !thread ||
    !(await isThreadInCallersScope(baseDataProvider, thread, membership))
  ) {
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

/**
 * FakeRest mirror of `public.set_thread_visibility()` (Story 7.3, Task 3;
 * Story 7.4, Task 2): "the FakeRest equivalent of the participant check, so
 * the demo build does not offer a control that silently succeeds for
 * everyone." Mirrors the real RPC's two refusals, in the same order:
 *
 *   1. an invalid `visibility` value.
 *   2. the caller may not act on this thread — the real RPC folds
 *      `thread_is_readable()` and "the caller is a listed participant" into
 *      one requirement (02_functions.sql's own comment on
 *      `set_thread_visibility()` explains why: for a `private` thread the
 *      two are the same test by construction). `isThreadInCallersScope`
 *      above now covers both axes, so this stands in for the whole
 *      readability requirement on either one.
 *
 * No visibility pre-check beyond scope mirrors the real RPC too:
 * thread_is_readable()'s OWN private branch is exactly the participant
 * check below, so a private thread's non-participant is caught by the
 * SAME `isThreadParticipant` call the open case uses — one check serves
 * both, just like the SQL.
 */
export async function setThreadVisibility(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  threadId: Identifier,
  visibility: ThreadVisibility,
): Promise<Thread> {
  if (!THREAD_VISIBILITIES.includes(visibility)) {
    throw new Error(`invalid thread visibility: ${visibility}`);
  }

  const identity = await getIdentity();
  if (identity == null) {
    throw new Error(
      "changing a discussion's privacy requires a signed-in user",
    );
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error("no active membership to change this discussion's privacy");
  }

  const { data: thread } = await baseDataProvider.getOne<Thread>("threads", {
    id: threadId,
  });
  if (
    !thread ||
    !(await isThreadInCallersScope(baseDataProvider, thread, membership))
  ) {
    throw new Error(`thread ${threadId} not found in current account`);
  }

  if (!(await isThreadParticipant(baseDataProvider, threadId, membership.id))) {
    throw new Error(
      "only a listed participant of this thread may change its visibility",
    );
  }

  const { data: updated } = await baseDataProvider.update<Thread>("threads", {
    id: threadId,
    data: { visibility },
    previousData: thread,
  });
  return updated;
}

/**
 * FakeRest mirror of `public.mark_thread_read()` (Story 7.5, AC-1, AC-2):
 * sets the CALLER'S OWN `thread_participants` row's `last_read_at` to now,
 * and touches no one else's — the demo-build analogue of the RPC's
 * `tp.member_id = current_member_id()` predicate, which is that function's
 * entire authorization check. A caller who has no participant row on this
 * thread at all resolves to `null` (nothing to update) rather than raising —
 * mirroring the real RPC's "zero rows affected, not an error" shape (AC-2).
 */
export async function markThreadRead(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  threadId: Identifier,
): Promise<ThreadParticipant | null> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("marking a discussion read requires a signed-in user");
  }
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership) {
    throw new Error("no active membership to mark a discussion read");
  }

  const { data: participants } =
    await baseDataProvider.getList<ThreadParticipant>("thread_participants", {
      filter: { thread_id: threadId, member_id: membership.id },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    });
  const participant = participants[0];
  if (!participant) {
    return null;
  }

  const { data: updated } = await baseDataProvider.update<ThreadParticipant>(
    "thread_participants",
    {
      id: participant.id,
      data: { last_read_at: new Date().toISOString() },
      previousData: participant,
    },
  );
  return updated;
}

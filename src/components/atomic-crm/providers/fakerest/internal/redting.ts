import type { DataProvider, Identifier } from "ra-core";

import type {
  AccountMember,
  Connection,
  InboxItem,
  RedtViaConnectionInput,
} from "../../../types";
import {
  resolveContextMembership,
  type GetIdentity,
} from "./accountMemberships";
import { createMessage, createThread } from "./threads";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const PAGE_ALL = { page: 1, perPage: 10_000 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;
const RAW_TEXT_MAX_LENGTH = 20_000;
const SUBJECT_MAX_LENGTH = 500;
const ATTACHMENTS_MAX_LENGTH = 20_000;

/**
 * FakeRest mirror of `public.redt_via_connection()` (Story 8.3, review-fix
 * revised). Every predicate below is copied from the SQL function's own
 * validation, in the same order — the same convention `./connections.ts`/
 * `./threads.ts` already establish for their own SQL counterparts.
 *
 * Review fix (Finding 4): the membership check now goes through
 * `resolveContextMembership` — the caller's ACTIVE CONTEXT must equal
 * `shadchanus_account_id`, not merely "any active `account_members` row of
 * it" (this file's own `activeMembershipsFor`, used before this fix). That
 * older check could diverge from the NESTED `createThread()` call's own
 * `resolveContextMembership`-based gate for a caller who also held an
 * active household membership: this function's old gate would pass while
 * `createThread()` independently passed too (the household being the
 * other legal party of the same connection), landing an inbox item
 * attributed to the shadchan while the mirror thread/message resolved to
 * the household's own membership — see `02_functions.sql`'s matching
 * comment for the SQL side of this same fix. Using the SAME resolver here
 * that `createThread()` already uses makes the two gates the one condition
 * by construction, exactly like the SQL fix.
 */
export async function redtViaConnection(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  input: RedtViaConnectionInput,
): Promise<InboxItem> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("redtViaConnection requires a signed-in user");
  }
  const userId = String(identity.id);

  const { data: connections } = await baseDataProvider.getList<Connection>(
    "connections",
    {
      filter: { id: input.connection_id, status: "accepted" },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    },
  );
  const connection = connections[0];
  if (!connection) {
    throw new Error(
      `connection ${input.connection_id} is not an active connection`,
    );
  }

  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (
    !membership ||
    String(membership.account_id) !== String(connection.shadchanus_account_id)
  ) {
    throw new Error(
      "caller is not an active member of this connection's shadchanus context",
    );
  }

  // Review fix (Finding 5): validate every client-supplied field BEFORE any
  // create — mirrors 02_functions.sql's own validation block exactly (same
  // required/length/shape rules, same order), so the demo build cannot
  // accept an input the production RPC would reject.
  if (input.raw_text == null || input.raw_text.trim().length === 0) {
    throw new Error("redt text is required");
  }
  if (input.raw_text.length > RAW_TEXT_MAX_LENGTH) {
    throw new Error(
      `redt text is too long (${input.raw_text.length} characters, limit ${RAW_TEXT_MAX_LENGTH})`,
    );
  }
  if (input.subject != null && input.subject.length > SUBJECT_MAX_LENGTH) {
    throw new Error(
      `redt subject is too long (${input.subject.length} characters, limit ${SUBJECT_MAX_LENGTH})`,
    );
  }
  if (input.attachments != null) {
    const isWellShapedArray =
      Array.isArray(input.attachments) &&
      JSON.stringify(input.attachments).length <= ATTACHMENTS_MAX_LENGTH;
    if (!isWellShapedArray) {
      throw new Error(
        `redt attachments must be a JSON array no larger than ${ATTACHMENTS_MAX_LENGTH} characters`,
      );
    }
  }

  const { data: shadchanusAccount } = await baseDataProvider.getOne(
    "accounts",
    { id: connection.shadchanus_account_id },
  );

  const now = new Date().toISOString();
  const { data: item } = await baseDataProvider.create<InboxItem>(
    "inbox_items",
    {
      data: {
        account_id: connection.household_account_id,
        source: "shadchan",
        subject: input.subject ?? null,
        raw_text: input.raw_text,
        sender: shadchanusAccount.name,
        attachments: input.attachments ?? null,
        status: "unresolved",
        // Deliberately null (Dev Notes, "Why the shadchan never sees the
        // household's chosen single"): the shadchan describes the candidate
        // in free text only — "which single" is resolved at the household's
        // confirm step (InboxResolveDialog.tsx), never here.
        single_id: null,
        shadchan_id: null,
        resolved_shidduchim_id: null,
        connection_id: input.connection_id,
        created_at: now,
      },
    },
  );

  // Story 8.3 (AC-5): mirror into a connection-scoped thread — the SAME
  // createThread()/createMessage() FakeRest mirrors Story 7.1/7.4 already
  // ship (./threads.ts), never a re-derived insert (.claude/rules/coding-
  // style.md DRY). createThread() already seats the calling shadchan as a
  // participant, so only the household's ACTIVE members are listed.
  const { data: householdMembers } =
    await baseDataProvider.getList<AccountMember>("account_members", {
      filter: {
        account_id: connection.household_account_id,
        status: "active",
      },
      pagination: PAGE_ALL,
      sort: SORT_BY_ID,
    });

  const thread = await createThread(
    baseDataProvider,
    getIdentity,
    getActiveAccountId,
    {
      subject_type: "relationship",
      connection_id: input.connection_id,
      participant_member_ids: householdMembers.map((m) => m.id),
    },
  );

  await createMessage(baseDataProvider, getIdentity, getActiveAccountId, {
    thread_id: thread.id,
    body: input.raw_text,
  });

  return item;
}

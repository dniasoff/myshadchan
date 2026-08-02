import type { DataProvider, Identifier } from "ra-core";

import type {
  AccountMember,
  Connection,
  InboxItem,
  RedtViaConnectionInput,
} from "../../../types";
import { activeMembershipsFor, type GetIdentity } from "./accountMemberships";
import { createMessage, createThread } from "./threads";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const PAGE_ALL = { page: 1, perPage: 10_000 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

/**
 * FakeRest mirror of `public.redt_via_connection()` (Story 8.3). Every
 * predicate below is copied from the SQL function's own validation, in the
 * same order — the same convention `./connections.ts`/`./threads.ts` already
 * establish for their own SQL counterparts.
 *
 * The membership check below deliberately checks for ANY active
 * `account_members` row of `shadchanus_account_id` — via `activeMembershipsFor`,
 * NOT `resolveContextMembership` (which is bound to the caller's CURRENT
 * ACTIVE CONTEXT). This mirrors `redt_via_connection()`'s own
 * `account_members` existence check exactly: any active member of the
 * shadchanus account may act for it, matching `create_shidduch()`'s own
 * precedent of never role- or context-gating beyond plain account
 * membership. The NESTED `createThread()` call below is the opposite — it
 * keeps ITS OWN `resolveContextMembership`-based gate unchanged, exactly
 * like the real `create_thread()` still requires `current_context_id()` to
 * be one side of the connection.
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

  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  const isActiveShadchanusMember = memberships.some(
    (m) => String(m.account_id) === String(connection.shadchanus_account_id),
  );
  if (!isActiveShadchanusMember) {
    throw new Error(
      "caller is not an active member of this connection's shadchanus context",
    );
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

import type { DataProvider } from "ra-core";

import type {
  ConversationLogEntry,
  LinkReferenceInput,
  LogReferenceCallInput,
  Reference,
  ReferenceLink,
  Shidduch,
} from "../../../types";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const BY_ID_ASC = { field: "id", order: "ASC" as const };

/**
 * The confirm half of match-on-entry (FakeRest mirror of
 * link_reference_to_shidduch): link the mention to the reference the user
 * recognised instead of creating a duplicate. Idempotent -- re-confirming an
 * existing (reference_id, shidduchim_id) pair returns the existing link
 * rather than creating a second one.
 *
 * Uses getList (not getOne) for the existence checks so a missing id yields
 * [] instead of throwing a generic error -- mirrors the addRedt/addSchool
 * idiom in dataProvider.ts.
 */
export async function linkReferenceToShidduch(
  baseDataProvider: DataProvider,
  input: LinkReferenceInput,
): Promise<ReferenceLink> {
  const { data: referenceMatches } = await baseDataProvider.getList<Reference>(
    "references",
    {
      filter: { id: input.reference_id },
      pagination: PAGE_ONE,
      sort: BY_ID_ASC,
    },
  );
  const reference = referenceMatches[0];
  if (!reference) {
    throw new Error(`reference ${input.reference_id} not found`);
  }

  const { data: shidduchMatches } = await baseDataProvider.getList<Shidduch>(
    "shidduchim",
    {
      filter: { id: input.shidduchim_id },
      pagination: PAGE_ONE,
      sort: BY_ID_ASC,
    },
  );
  if (!shidduchMatches[0]) {
    throw new Error(`shidduch ${input.shidduchim_id} not found`);
  }

  const { data: existing } = await baseDataProvider.getList<ReferenceLink>(
    "reference_links",
    {
      filter: {
        reference_id: input.reference_id,
        shidduchim_id: input.shidduchim_id,
      },
      pagination: PAGE_ONE,
      sort: BY_ID_ASC,
    },
  );
  if (existing[0]) {
    return existing[0];
  }

  const now = new Date().toISOString();
  const { data: link } = await baseDataProvider.create<ReferenceLink>(
    "reference_links",
    {
      data: {
        account_id: reference.account_id,
        reference_id: input.reference_id,
        shidduchim_id: input.shidduchim_id,
        resume_id: null,
        call_status: "not_started",
        what_they_said: null,
        conversation_log: [],
        relationship_override: input.relationship_override ?? null,
        created_at: now,
      },
    },
  );

  await baseDataProvider.create("interactions", {
    data: {
      account_id: reference.account_id,
      target_type: "reference",
      target_id: input.reference_id,
      scope: "shidduch" as const,
      reference_link_id: link.id,
      actor_member_id: null,
      kind: "link_created",
      body: null,
      metadata: { shidduchim_id: input.shidduchim_id },
      created_at: now,
    },
  });

  return link;
}

/**
 * The one write path for call capture (FakeRest mirror of
 * log_reference_call). Both the mid-call capture screen and the guided call
 * script go through this, appending to conversation_log and pushing a
 * "call_logged" interaction, so the assistant can never become a second,
 * disconnected data path.
 */
export async function logReferenceCall(
  baseDataProvider: DataProvider,
  input: LogReferenceCallInput,
): Promise<ReferenceLink> {
  const { data: matches } = await baseDataProvider.getList<ReferenceLink>(
    "reference_links",
    {
      filter: { id: input.reference_link_id },
      pagination: PAGE_ONE,
      sort: BY_ID_ASC,
    },
  );
  const link = matches[0];
  if (!link) {
    throw new Error(`reference link ${input.reference_link_id} not found`);
  }

  const now = new Date().toISOString();
  const source = input.source ?? "manual";
  const callStatus = input.call_status ?? link.call_status ?? null;
  const entry: ConversationLogEntry = {
    at: now,
    call_status: callStatus,
    text: input.what_they_said || null,
    source,
    member_id: null,
  };

  const { data: updated } = await baseDataProvider.update<ReferenceLink>(
    "reference_links",
    {
      id: input.reference_link_id,
      data: {
        call_status: callStatus,
        what_they_said: input.what_they_said || link.what_they_said || null,
        conversation_log: [...(link.conversation_log ?? []), entry],
      },
      previousData: link,
    },
  );

  await baseDataProvider.create("interactions", {
    data: {
      account_id: link.account_id,
      target_type: "reference",
      target_id: link.reference_id,
      scope: "shidduch" as const,
      reference_link_id: link.id,
      actor_member_id: null,
      kind: "call_logged",
      body: input.what_they_said || null,
      metadata: {
        call_status: callStatus,
        shidduchim_id: link.shidduchim_id,
        source,
      },
      created_at: now,
    },
  });

  return updated;
}

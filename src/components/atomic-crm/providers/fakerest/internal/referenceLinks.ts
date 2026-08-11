import type { DataProvider } from "ra-core";

import type {
  ConversationLogEntry,
  CreateReferenceForShidduchInput,
  LinkReferenceInput,
  LogReferenceCallInput,
  Reference,
  ReferenceLink,
  Shidduch,
  ShidduchDiligenceProgress,
} from "../../../types";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const BY_ID_ASC = { field: "id", order: "ASC" as const };

/**
 * Computes the diligence progress for a shidduch (FakeRest mirror of
 * shidduch_diligence_progress RPC). Returns counts only — no reference
 * names, relationships, phone numbers, or notes.
 */
export async function computeDiligenceProgress(
  baseDataProvider: DataProvider,
  shidduchimId: number,
): Promise<ShidduchDiligenceProgress> {
  const { data: links } = await baseDataProvider.getList<ReferenceLink>(
    "reference_links",
    {
      filter: { shidduchim_id: shidduchimId },
      pagination: { page: 1, perPage: 1000 },
      sort: BY_ID_ASC,
    },
  );

  const total = links.length;
  const contacted = links.filter(
    (link) =>
      link.call_status === "answered" ||
      link.call_status === "they_will_call_back",
  ).length;

  return { contacted, total, outstanding: total - contacted };
}

/**
 * The confirm half of match-on-entry (FakeRest mirror of
 * link_reference_to_shidduch): link the mention to the reference the user
 * recognised instead of creating a duplicate. Idempotent -- re-confirming an
 * existing (reference_id, shidduchim_id) pair returns the existing link
 * rather than creating a second one.
 *
 * Uses getList (not getOne) for the existence checks so a missing id yields
 * [] instead of throwing a generic error -- mirrors the addRedt/addEducation
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
 * FakeRest mirror of `create_reference_for_shidduch` (RULING 7 R7): create the
 * reference and attach it to the shidduch as one operation, so the demo build
 * cannot produce the orphan the two-call path could. Unlike
 * `linkReferenceToShidduch` above, `account_id` is taken from the SHIDDUCH —
 * there is no reference yet to take it from.
 */
export async function createReferenceForShidduch(
  baseDataProvider: DataProvider,
  input: CreateReferenceForShidduchInput,
): Promise<Reference> {
  const { data: shidduchMatches } = await baseDataProvider.getList<Shidduch>(
    "shidduchim",
    {
      filter: { id: input.shidduchim_id },
      pagination: PAGE_ONE,
      sort: BY_ID_ASC,
    },
  );
  const shidduch = shidduchMatches[0];
  if (!shidduch) {
    throw new Error(`shidduch ${input.shidduchim_id} not found`);
  }

  const now = new Date().toISOString();
  const { data: reference } = await baseDataProvider.create<Reference>(
    "references",
    {
      data: {
        account_id: shidduch.account_id,
        name_en: input.name_en ?? null,
        name_he: input.name_he ?? null,
        relationship: input.relationship ?? null,
        phone: input.phone ?? null,
        school: input.school ?? null,
        grad_year: input.grad_year ?? null,
        created_at: now,
      },
    },
  );

  const { data: link } = await baseDataProvider.create<ReferenceLink>(
    "reference_links",
    {
      data: {
        account_id: reference.account_id,
        reference_id: reference.id,
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
      target_id: reference.id,
      scope: "shidduch" as const,
      reference_link_id: link.id,
      actor_member_id: null,
      kind: "link_created",
      body: null,
      metadata: { shidduchim_id: input.shidduchim_id },
      created_at: now,
    },
  });

  return reference;
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

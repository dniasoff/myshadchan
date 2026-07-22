import type { DataProvider, Identifier } from "ra-core";

import type {
  ConversationLogEntry,
  Interaction,
  MergeResolution,
  Reference,
  ReferenceLink,
  ReferenceMergeCollision,
  ReferenceMergePreview,
  Shidduch,
  Task,
} from "../../../types";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;
const PAGE_ONE = { page: 1, perPage: 1 } as const;
const BY_ID_ASC = { field: "id", order: "ASC" as const };

const getReferenceOrThrow = async (
  baseDataProvider: DataProvider,
  id: Identifier,
): Promise<Reference> => {
  const { data } = await baseDataProvider.getList<Reference>("references", {
    filter: { id },
    pagination: PAGE_ONE,
    sort: BY_ID_ASC,
  });
  if (!data[0]) {
    throw new Error(`reference ${id} not found`);
  }
  return data[0];
};

/**
 * What a merge would do, before anything is destroyed (FakeRest mirror of
 * preview_reference_merge). `collisions` is the case the contacts merge never
 * has to handle: both duplicates hold a reference_links row for the SAME
 * shidduchim_id. The UI must make the user resolve each one before merging.
 */
export async function previewReferenceMerge(
  baseDataProvider: DataProvider,
  loserId: Identifier,
  winnerId: Identifier,
): Promise<ReferenceMergePreview> {
  const [loser, winner] = await Promise.all([
    getReferenceOrThrow(baseDataProvider, loserId),
    getReferenceOrThrow(baseDataProvider, winnerId),
  ]);

  const [
    { data: loserLinks },
    { data: winnerLinks },
    { data: interactions },
    { data: tasks },
    { data: shidduchim },
  ] = await Promise.all([
    baseDataProvider.getList<ReferenceLink>("reference_links", {
      filter: { reference_id: loserId },
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    }),
    baseDataProvider.getList<ReferenceLink>("reference_links", {
      filter: { reference_id: winnerId },
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    }),
    baseDataProvider.getList<Interaction>("interactions", {
      filter: { target_type: "reference", target_id: loserId },
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    }),
    baseDataProvider.getList<Task>("tasks", {
      filter: { target_type: "reference", target_id: loserId },
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    }),
    baseDataProvider.getList<Shidduch>("shidduchim", {
      filter: {},
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    }),
  ]);

  const shidduchById = new Map(shidduchim.map((s) => [s.id, s]));
  const collisions = buildCollisions(loserLinks, winnerLinks, shidduchById);

  return {
    loser,
    winner,
    reference_links_count: loserLinks.length,
    interactions_count: interactions.length,
    open_tasks_count: tasks.filter((task) => !task.done_date).length,
    collisions,
  };
}

function buildCollisions(
  loserLinks: ReferenceLink[],
  winnerLinks: ReferenceLink[],
  shidduchById: Map<Identifier, Shidduch>,
): ReferenceMergeCollision[] {
  const collisions: ReferenceMergeCollision[] = [];
  for (const loserLink of loserLinks) {
    if (loserLink.shidduchim_id == null) continue;
    const winnerLink = winnerLinks.find(
      (link) => link.shidduchim_id === loserLink.shidduchim_id,
    );
    if (!winnerLink) continue;
    const shidduch = shidduchById.get(loserLink.shidduchim_id);
    collisions.push({
      shidduchim_id: loserLink.shidduchim_id,
      shidduch_name_en: shidduch?.name_en ?? null,
      shidduch_name_he: shidduch?.name_he ?? null,
      loser_link: {
        id: loserLink.id,
        call_status: loserLink.call_status ?? null,
        what_they_said: loserLink.what_they_said ?? null,
        conversation_log_count: (loserLink.conversation_log ?? []).length,
      },
      winner_link: {
        id: winnerLink.id,
        call_status: winnerLink.call_status ?? null,
        what_they_said: winnerLink.what_they_said ?? null,
        conversation_log_count: (winnerLink.conversation_log ?? []).length,
      },
    });
  }
  return collisions;
}

/**
 * Merge two duplicate references (FakeRest mirror of merge_references).
 * Refuses to run if any collision (see previewReferenceMerge) is missing a
 * resolution -- silently discarding one side's call log is exactly the data
 * loss this design refuses to risk. Otherwise moves every reference_links,
 * interactions and tasks row from loser to winner, applies each collision's
 * resolution, and deletes the loser.
 */
export async function mergeReferences(
  baseDataProvider: DataProvider,
  loserId: Identifier,
  winnerId: Identifier,
  resolutions: Record<string, MergeResolution>,
): Promise<Identifier> {
  if (String(loserId) === String(winnerId)) {
    throw new Error("cannot merge a reference into itself");
  }

  const preview = await previewReferenceMerge(
    baseDataProvider,
    loserId,
    winnerId,
  );
  const unresolved = preview.collisions.find(
    (collision) => resolutions[String(collision.shidduchim_id)] == null,
  );
  if (unresolved) {
    throw new Error(
      `unresolved merge conflict: both references are linked to shidduch ${unresolved.shidduchim_id}. Choose which call log to keep before merging.`,
    );
  }

  for (const collision of preview.collisions) {
    await resolveCollision(
      baseDataProvider,
      collision,
      resolutions[String(collision.shidduchim_id)],
    );
  }

  await reassignRemaining(
    baseDataProvider,
    "reference_links",
    "reference_id",
    loserId,
    winnerId,
  );
  await reassignRemaining(
    baseDataProvider,
    "interactions",
    "target_id",
    loserId,
    winnerId,
    {
      target_type: "reference",
    },
  );
  await reassignRemaining(
    baseDataProvider,
    "tasks",
    "target_id",
    loserId,
    winnerId,
    {
      target_type: "reference",
    },
  );

  await baseDataProvider.create("interactions", {
    data: {
      account_id: preview.winner.account_id,
      target_type: "reference",
      target_id: winnerId,
      scope: "account" as const,
      reference_link_id: null,
      actor_member_id: null,
      kind: "merge",
      body: null,
      metadata: { merged_from_reference_id: loserId },
      created_at: new Date().toISOString(),
    },
  });

  await baseDataProvider.delete("references", {
    id: loserId,
    previousData: preview.loser,
  });

  return winnerId;
}

async function resolveCollision(
  baseDataProvider: DataProvider,
  collision: ReferenceMergeCollision,
  resolution: MergeResolution,
): Promise<void> {
  const { data: loserLink } = await baseDataProvider.getOne<ReferenceLink>(
    "reference_links",
    { id: collision.loser_link.id },
  );
  const { data: winnerLink } = await baseDataProvider.getOne<ReferenceLink>(
    "reference_links",
    { id: collision.winner_link.id },
  );
  const loserLog: ConversationLogEntry[] = loserLink.conversation_log ?? [];
  const winnerLog: ConversationLogEntry[] = winnerLink.conversation_log ?? [];

  const winnerUpdate = buildWinnerLinkUpdate(
    resolution,
    loserLink,
    winnerLink,
    loserLog,
    winnerLog,
  );
  if (winnerUpdate) {
    await baseDataProvider.update("reference_links", {
      id: winnerLink.id,
      data: winnerUpdate,
      previousData: winnerLink,
    });
  }

  // Re-home the losing link's own interactions before dropping it -- the
  // conversation history it carries must never disappear, only be re-filed.
  const { data: linkInteractions } =
    await baseDataProvider.getList<Interaction>("interactions", {
      filter: { reference_link_id: loserLink.id },
      pagination: PAGE_ALL,
      sort: BY_ID_ASC,
    });
  await Promise.all(
    linkInteractions.map((interaction) =>
      baseDataProvider.update("interactions", {
        id: interaction.id,
        data: { reference_link_id: winnerLink.id },
        previousData: interaction,
      }),
    ),
  );

  await baseDataProvider.delete("reference_links", {
    id: loserLink.id,
    previousData: loserLink,
  });
}

function buildWinnerLinkUpdate(
  resolution: MergeResolution,
  loserLink: ReferenceLink,
  winnerLink: ReferenceLink,
  loserLog: ConversationLogEntry[],
  winnerLog: ConversationLogEntry[],
): Partial<ReferenceLink> | null {
  if (resolution === "winner") {
    // Keep the winner link exactly as it is; the loser's call log is dropped
    // (its interactions were already re-homed above, so nothing is lost).
    return null;
  }
  if (resolution === "loser") {
    return {
      call_status: loserLink.call_status ?? winnerLink.call_status ?? null,
      what_they_said:
        loserLink.what_they_said ?? winnerLink.what_they_said ?? null,
      conversation_log: [...winnerLog, ...loserLog],
    };
  }
  // "both": keep both call logs, concatenated.
  return {
    conversation_log: [...winnerLog, ...loserLog],
    what_they_said:
      [winnerLink.what_they_said, loserLink.what_they_said]
        .filter((text): text is string => Boolean(text))
        .join("\n\n") || null,
  };
}

async function reassignRemaining(
  baseDataProvider: DataProvider,
  resource: string,
  targetField: "reference_id" | "target_id",
  loserId: Identifier,
  winnerId: Identifier,
  extraFilter: Record<string, unknown> = {},
): Promise<void> {
  const { data: rows } = await baseDataProvider.getList(resource, {
    filter: { ...extraFilter, [targetField]: loserId },
    pagination: PAGE_ALL,
    sort: BY_ID_ASC,
  });
  await Promise.all(
    rows.map((row: { id: Identifier }) =>
      baseDataProvider.update(resource, {
        id: row.id,
        data: { [targetField]: winnerId },
        previousData: row,
      }),
    ),
  );
}

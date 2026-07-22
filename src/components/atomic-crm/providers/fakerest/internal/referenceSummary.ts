import type { DataProvider } from "ra-core";

import type {
  Child,
  Interaction,
  Reference,
  ReferenceLink,
  ReferenceLinkSummary,
  ReferenceSummary,
  Shidduch,
  Task,
} from "../../../types";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;
const BY_ID_ASC = { field: "id", order: "ASC" as const };

const CONTACTED_STATUSES = new Set(["answered", "they_will_call_back"]);

/**
 * FakeRest mirror of the references_summary view (AD-10): joins in every
 * reference's link/interaction/task counts so the reference book's list read
 * path never needs an N+1 fetch.
 */
export async function enrichReferences(
  baseDataProvider: DataProvider,
  rows: Reference[],
): Promise<ReferenceSummary[]> {
  if (rows.length === 0) return [];

  const [{ data: links }, { data: interactions }, { data: tasks }] =
    await Promise.all([
      baseDataProvider.getList<ReferenceLink>("reference_links", {
        filter: {},
        pagination: PAGE_ALL,
        sort: BY_ID_ASC,
      }),
      baseDataProvider
        .getList<Interaction>("interactions", {
          filter: { target_type: "reference" },
          pagination: PAGE_ALL,
          sort: BY_ID_ASC,
        })
        .catch(() => ({ data: [] as Interaction[] })),
      baseDataProvider.getList<Task>("tasks", {
        filter: { target_type: "reference" },
        pagination: PAGE_ALL,
        sort: BY_ID_ASC,
      }),
    ]);

  return rows.map((reference) => {
    const ownLinks = links.filter((link) => link.reference_id === reference.id);
    const linkedShidduchimCount = new Set(
      ownLinks
        .filter((link) => link.shidduchim_id != null)
        .map((link) => link.shidduchim_id),
    ).size;
    const contactedCount = ownLinks.filter(
      (link) =>
        link.call_status != null && CONTACTED_STATUSES.has(link.call_status),
    ).length;
    const callLogged = interactions
      .filter(
        (interaction) =>
          interaction.target_id === reference.id &&
          interaction.kind === "call_logged",
      )
      .map((interaction) => interaction.created_at)
      .sort();
    const openTaskCount = tasks.filter(
      (task) => task.target_id === reference.id && !task.done_date,
    ).length;

    return {
      ...reference,
      linked_shidduchim_count: linkedShidduchimCount,
      contacted_count: contactedCount,
      last_conversation_at: callLogged.length
        ? callLogged[callLogged.length - 1]
        : null,
      open_task_count: openTaskCount,
    };
  });
}

/**
 * FakeRest mirror of the reference_links_summary view (AD-10): one row per
 * reference<->shidduch conversation, complete enough to render both the
 * per-shidduch call-log card and the repeat-recognition panel without a
 * second round-trip.
 */
export async function enrichReferenceLinks(
  baseDataProvider: DataProvider,
  rows: ReferenceLink[],
): Promise<ReferenceLinkSummary[]> {
  if (rows.length === 0) return [];

  const [{ data: references }, { data: shidduchim }, { data: children }] =
    await Promise.all([
      baseDataProvider.getList<Reference>("references", {
        filter: {},
        pagination: PAGE_ALL,
        sort: BY_ID_ASC,
      }),
      baseDataProvider.getList<Shidduch>("shidduchim", {
        filter: {},
        pagination: PAGE_ALL,
        sort: BY_ID_ASC,
      }),
      baseDataProvider.getList<Child>("children", {
        filter: {},
        pagination: PAGE_ALL,
        sort: BY_ID_ASC,
      }),
    ]);

  const referenceById = new Map(
    references.map((reference) => [reference.id, reference]),
  );
  const shidduchById = new Map(
    shidduchim.map((shidduch) => [shidduch.id, shidduch]),
  );
  const childById = new Map(children.map((child) => [child.id, child]));

  return rows.map((link) => {
    const reference = referenceById.get(link.reference_id);
    const shidduch =
      link.shidduchim_id != null
        ? shidduchById.get(link.shidduchim_id)
        : undefined;
    const child = shidduch ? childById.get(shidduch.child_id) : undefined;

    return {
      ...link,
      effective_relationship:
        link.relationship_override ?? reference?.relationship ?? null,
      conversation_log_count: (link.conversation_log ?? []).length,
      reference_name_en: reference?.name_en ?? null,
      reference_name_he: reference?.name_he ?? null,
      reference_phone: reference?.phone ?? null,
      shidduch_name_en: shidduch?.name_en ?? null,
      shidduch_name_he: shidduch?.name_he ?? null,
      shidduch_pipeline_state: shidduch?.pipeline_state ?? null,
      shidduch_visibility: shidduch?.visibility ?? null,
      child_id: shidduch?.child_id ?? null,
      child_first_name_en: child?.first_name_en ?? null,
      child_first_name_he: child?.first_name_he ?? null,
    };
  });
}

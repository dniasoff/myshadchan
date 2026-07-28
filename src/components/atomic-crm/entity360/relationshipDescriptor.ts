import type { Identifier, RaRecord } from "ra-core";

import type { TabKey } from "./tabKeys";

/**
 * Declares a "related records" tab: a list of rows from another resource,
 * filtered by the subject record, each rendered as a `RecordLink` (contract
 * §9). Lives in its own module rather than in `entityDescriptor.ts` because
 * it is keyed by `TabKey` and consumed by `RelatedRecordsTab`, both of which
 * land in this story — before `entityDescriptor.ts` (Story 3.3a) exists.
 * 3.3a's `EntityDescriptor.relationships` imports and re-exports this type,
 * so `entity360/entityDescriptor.ts` stays the one import site consumers
 * need to know about.
 *
 * `{ resource, foreignKey }` cannot express the one many-to-many the domain
 * actually has — reference → reference_links → shidduchim — so the queried
 * `resource` may be a summary view that already resolves a join table, and
 * `linkResource` / `linkId` / `linkLabel` let the rendered `RecordLink`
 * target a different resource, at a different id column, than the one that
 * was queried.
 *
 * **Rule: a relationship whose `linkResource` differs from its `resource`
 * MUST supply `linkLabel`.** The queried row is a link/summary row — the
 * link target's `recordRepresentation` will not resolve against it (its
 * fields belong to the link row, not the target record).
 *
 * Two worked examples (column names verified against the schema — contract
 * §9's own example cites the non-existent `row.shidduch_id`; the view's
 * column is `shidduchim_id`):
 *
 * ```ts
 * // reference → its shidduchim (many-to-many, through the link table's
 * // summary view). linkResource differs from resource, so linkLabel is
 * // required.
 * const referenceShidduchim: EntityRelationshipDescriptor = {
 *   key: "shidduchim",
 *   resource: "reference_links_summary",
 *   getFilter: (r) => ({ reference_id: r.id }),
 *   linkResource: "shidduchim",
 *   linkId: (row) => row.shidduchim_id,
 *   linkLabel: (row) => row.shidduch_name_en,
 * };
 *
 * // single → its shidduchim (plain FK). resource IS the link target, so no
 * // linkResource/linkId/linkLabel is needed.
 * const singleShidduchim: EntityRelationshipDescriptor = {
 *   key: "shidduchim",
 *   resource: "shidduchim",
 *   getFilter: (r) => ({ single_id: r.id }),
 * };
 * ```
 *
 * This story registers no relationship. The two examples above are test
 * fixtures and Epic 5 reference material, not registrations.
 */
export type EntityRelationshipDescriptor<T = RaRecord> = {
  /** closed union — see tabKeys.ts */
  key: TabKey;
  /** override only; resolves per contract §3 rule 2 */
  label?: string;
  /** resource to query — MAY be a summary view that already resolves a join table */
  resource: string;
  getFilter: (record: T) => Record<string, unknown>;
  sort?: { field: string; order: "ASC" | "DESC" };
  perPage?: number;
  /** resource the row's RecordLink targets; defaults to `resource` */
  linkResource?: string;
  /** id the RecordLink navigates to; defaults to (row) => row.id
   *  `any` here is contract §9's one sanctioned use: the row's shape
   *  belongs to a summary view the descriptor's author knows and the
   *  framework cannot express generically. */
  linkId?: (row: any) => Identifier;
  /** row label; defaults to the resource's recordRepresentation */
  linkLabel?: (row: any) => string;
  emptyLabel?: string;
};

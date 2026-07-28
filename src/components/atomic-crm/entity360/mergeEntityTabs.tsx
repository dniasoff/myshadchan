import type { ReactNode } from "react";

import type { EntityTabDescriptor } from "./entityDescriptor";
import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";
import type { TabKey } from "./tabKeys";
import { RelatedRecordsTab } from "./tabs/RelatedRecordsTab";

export interface MergedEntityTab {
  key: TabKey;
  label?: string;
  render: () => ReactNode;
}

/**
 * AC 10 — merges a descriptor's explicit `tabs` with its `relationships`,
 * each relationship becoming a tab that renders `RelatedRecordsTab`. **An
 * explicit `tabs` entry always wins**: a relationship whose `key` already
 * has an entry in `tabs` is dropped entirely, so `RelatedRecordsTab` is
 * never mounted for it.
 *
 * **Ordering, and why it is a concatenation, not a lookup into a canonical
 * table.** The contract's own phrasing — a relationship lands "at the
 * position its key occupies in the entity's declared tab order" —
 * presupposes a per-entity canonical ordering (Epic 3 API contract §3 rule
 * 5's `CANONICAL_TAB_SETS`), but that table is owned by the AD-24
 * conformance validator (Story 3-15 / `3-11-ad24-conformance-validator.md`),
 * which lands at build-order step 12 — seven steps after this one (step 5).
 * `EntityShow` is also structurally forbidden from importing anything keyed
 * by entity name (AC 9's `?raw` boundary), so it cannot resolve "this
 * entity's canonical order" even if the table existed yet. This function
 * therefore defines "declared order" as the order the descriptor itself
 * declares things in: `tabs`, verbatim, in the order the author wrote
 * them (already required to be a canonical-order subsequence by rule 5c),
 * followed by any `relationships` entries not already covered by `tabs`,
 * in the order `relationships` declares them. Flagged in this story's
 * final report as an interpretation the contract underspecifies, for 3-15
 * to reconcile once `CANONICAL_TAB_SETS` exists.
 */
export function mergeEntityTabs(
  tabs: EntityTabDescriptor[] = [],
  relationships: EntityRelationshipDescriptor[] = [],
): MergedEntityTab[] {
  const explicitKeys = new Set(tabs.map((tab) => tab.key));

  const relationshipTabs: MergedEntityTab[] = relationships
    .filter((relationship) => !explicitKeys.has(relationship.key))
    .map((relationship) => ({
      key: relationship.key,
      label: relationship.label,
      render: () => <RelatedRecordsTab relationship={relationship} />,
    }));

  return [...tabs, ...relationshipTabs];
}

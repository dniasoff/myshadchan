import type { ReactNode } from "react";

import type { EntityTabDescriptor } from "./entityDescriptor";
import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";
import type { TabKey } from "./tabKeys";
import { RelatedRecordsTab } from "./tabs/RelatedRecordsTab";
import type { MemberRole } from "../types";

/**
 * Story 3.4 — carries `visibleTo` through from an explicit `tabs` entry.
 * The function below spreads `tabs` verbatim into its return value, so an
 * explicit tab's `visibleTo` already survived at runtime before this field
 * existed on the type; declaring it here just makes that honest, and lets
 * `EntityShow` filter the MERGED array (not `descriptor.tabs` before the
 * merge) without a cast. Filtering post-merge — rather than pre-filtering
 * `descriptor.tabs` — matters for one interaction: an explicit tab wins its
 * key's slot over a same-keyed relationship regardless of visibility, so a
 * denied explicit tab does not leave that key's relationship-derived
 * fallback to render in its place. A relationship-derived tab always has
 * `visibleTo: undefined` (the "Known gap, recorded" acceptance in this
 * story's Dev Notes) — unrestricted, per `hasVisibility`'s own rule.
 */
export interface MergedEntityTab {
  key: TabKey;
  label?: string;
  render: () => ReactNode;
  visibleTo?: MemberRole[];
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
 *
 * **Concrete, not merely theoretical: this concatenation is the wrong
 * on-screen order for three of Epic 3's four real entities as soon as they
 * use `relationships` the way this story wires it.** The contract's own
 * canonical rows (§3 rule 5) put `shidduchim` *mid-list* for Single
 * (`overview, resume, photo, files, shidduchim, notes, tasks, activity`),
 * Shadchan (`overview, shidduchim, notes, tasks, activity`) and Reference
 * (`overview, conversations, shidduchim, notes, tasks, activity, assistant`)
 * — but this function always appends every relationship-derived tab after
 * every explicit `tabs` entry, so `shidduchim` renders **last** for all
 * three, diverging from UX-DR5. Story 3-15's validator only checks
 * `keys(tabs) ∪ pendingTabs` as sets (§3 rule 5d) and cannot see interleaved
 * order, so it will not catch this. The practical consequence for Epic 5:
 * an entity that wants `shidduchim` mid-list must declare it as an explicit
 * `tabs` entry rendering `<RelatedRecordsTab relationship={...}/>` itself,
 * at the correct position — bypassing `relationships` entirely rather than
 * relying on this merge's ordering. `relationships` remains correct for an
 * entity happy to have its relationship-derived tabs trail (or for one
 * whose canonical row already ends with them). Contract owner's call on
 * whether §9 should be amended to require callers to pre-position, or
 * whether this function should gain a per-entity ordering input once
 * `CANONICAL_TAB_SETS` exists.
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

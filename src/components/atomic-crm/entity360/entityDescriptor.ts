import type { ComponentType, ReactNode } from "react";
import type { Identifier, RaRecord } from "ra-core";
import type { LucideIcon } from "lucide-react";

import type { MemberRole } from "../types";
import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";
import type { TabKey } from "./tabKeys";

/**
 * `EntityRelationshipDescriptor` is authored in `relationshipDescriptor.ts`
 * (Story 3-13, `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`
 * AC 6), keyed by `TabKey` and consumed by that story's `RelatedRecordsTab`.
 * It is imported and re-exported here so every consumer needs to know about
 * only one module. A second, independent declaration of this type anywhere
 * under `entity360/` is a review-blocking defect, on the same footing as
 * re-declaring `MemberRole` or `TabKey`.
 */
export type { EntityRelationshipDescriptor };

/**
 * AD-24's single source of truth for what an entity's 360 — and, per the
 * fields below, its list row — declare. `label` / `icon` / `meta` are list
 * metadata as well as 360 metadata: `EntityList` (Story 4.1) consumes
 * `label` only today, as a `translate` fallback. Any future list wiring
 * consumes THIS type and never redefines it — a second, list-specific
 * descriptor shape would let the 360 and the list drift, which is the exact
 * failure AD-24 exists to prevent.
 *
 * A descriptor's home is `src/components/atomic-crm/<entity>/entityDescriptor.ts`.
 * That module exports the descriptor object **and** calls
 * `registerEntityDescriptor` (see `./registry`) at module scope;
 * `<entity>/index.ts` adds `import "./entityDescriptor";` as its first line.
 * `root/routeManifest.ts` already imports every resource index module at
 * module scope and `CRM.tsx` maps over `RESOURCES` at boot, so registration
 * is complete before first render — no lazy import, no registration inside a
 * component, no `useEffect`.
 *
 * No descriptor may read another descriptor at module scope: registry order
 * is irrelevant and must stay irrelevant (contract §4 rule 6).
 *
 * This file (and `./registry`) registers nothing itself — Epic 3 registers
 * descriptors only from Story 3.9's four entity stub modules.
 */
export type EntityDescriptor<T extends RaRecord = RaRecord> = {
  /** Resource name exactly as registered in `root/routeManifest.ts` (plural, snake_case). */
  name: string;
  /** REQUIRED. Epic 5 flips these from `/{r}/{id}/show` to `/{r}/{id}`, one line each. */
  buildRecordPath: (id: Identifier) => string;
  /** REQUIRED — Story 4.1 uses it as a `translate` fallback, which needs `string`, not `string | undefined`. */
  label: string;
  icon?: LucideIcon;

  // --- Region renderers. ComponentType<{record}>, NOT (record) => ReactNode.
  //     They are a component boundary, so they MAY call hooks (useGetOne,
  //     useGetList, …). The descriptor module owns its own data loading —
  //     EntityShow (Story 3.3b) never fetches for a region.
  identityHeader?: ComponentType<{ record: T }>;
  statBand?: ComponentType<{ record: T }>;
  rightRail?: ComponentType<{ record: T }>;
  /** Rendered INSIDE the identityHeader region, immediately after it. Never a region of its own on `Entity360`. */
  actions?: ComponentType<{ record: T }>;
  alertSlot?: ComponentType<{ record: T }>;

  // --- Default identity composition. Used ONLY when `identityHeader` is absent.
  avatar?: (record: T) => { seed: string | null };
  title?: (record: T) => string;
  meta?: (record: T) => (string | null | undefined)[];

  tabs?: EntityTabDescriptor[];

  /**
   * Canonical tabs this entity WILL have and does not have YET. Declared,
   * never inferred: the AD-24 conformance validator (3-15) asserts
   * `keys(tabs) ∪ pendingTabs` equals the entity's canonical tab set, as
   * SETS (contract §3 rule 5), so a partial `tabs` is legal and a forgotten
   * tab is still caught. Must itself be canonically ordered and drawn from
   * `TabKey`. A stub descriptor is `tabs: []` plus a full `pendingTabs` —
   * there is no separate stub-exemption list. Descriptor metadata only —
   * nothing renders it, and it is NOT an `Entity360` region (the shell's
   * prop list stays at exactly seven).
   */
  pendingTabs?: TabKey[];

  relationships?: EntityRelationshipDescriptor<T>[];
};

/**
 * Deliberately non-generic: `render` is arity-zero (rule below) and no field
 * here carries the record's type — the contract's own snippet writes
 * `EntityTabDescriptor<T = RaRecord>`, but that `T` is never referenced by
 * any field and fails `noUnusedLocals`; dropped rather than threaded through
 * for no consumer (see this story's report for the discrepancy).
 */
export type EntityTabDescriptor = {
  /** Closed union — see `./tabKeys`. */
  key: TabKey;
  /**
   * OPTIONAL — and omitting it is the NORMAL case, not the exception.
   * Absent, the label resolves through the i18n catalog with
   * `TAB_LABELS[key]` as the untranslated fallback (contract §3 rule 2).
   * Set it ONLY for a genuine per-entity deviation from the canonical
   * vocabulary, and carry a one-line comment saying why THAT entity
   * deviates.
   */
  label?: string;
  /**
   * LAZY — no argument. The tab's subtree is constructed only when it is
   * the active tab. The record is reached inside `render` via
   * `useRecordContext()` — `EntityShow` mounts inside `ShowBase`, so a
   * `RecordContext` always exists.
   */
  render: () => ReactNode;
  /** Allow-list. Absent = visible to every role. */
  visibleTo?: MemberRole[];
};

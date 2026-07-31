import type { ResourceEntry } from "../root/routeManifest";
import type { EntityDescriptor } from "./entityDescriptor";
import { isTabKey, type TabKey } from "./tabKeys";

/**
 * AD-24 conformance validator (Story 3-11 / architecture spine §AD-24).
 * Epic 3 builds the `Entity360` framework; Epic 5 migrates the four AD-24
 * entities (`shidduchim`, `singles`, `shadchanim`, `references`) onto it one
 * story at a time. This module is the mechanical guarantee that the
 * migration cannot be done half-way and forgotten: every rule below is
 * either unconditional (AC 6's consistency half, AC 10) or backed by a
 * SYMMETRIC exemption table, never a one-way allowlist —
 *
 *   - an offender not in the table -> the rule's own violation code fires;
 *   - a table entry that is no longer an offender -> `stale-exemption`;
 *   - a `kind: "permanent"` entry naming a resource that has since acquired
 *     a registered `EntityDescriptor` -> `permanent-exemption-for-360-entity`.
 *
 * A migrating story (5.1, 5.8, 5.9, 5.10, …) MUST delete its own exemption
 * entries in the SAME diff that fixes the underlying resource — the
 * symmetric check fails the build otherwise. Likewise, a story that builds a
 * tab moves that key from `pendingTabs` into `tabs` in the same diff (AC 6d
 * fails the build otherwise), and Epic 5's closing story flips the
 * `findPendingTabs` informational ledger assertion in
 * `ad24Conformance.test.ts` to `toEqual([])` (AC 9) — Epic 3 cannot be
 * declared done with tabs, or target types (`pendingDbWidenings.ts`), still
 * pending.
 *
 * `NO_BROWSE_SURFACE_ENTITIES` is different in kind: it is a STANDING OWNER
 * RULING (RULING 7 — "references only exist as part of an individual
 * shidduch and cannot be browsed separately … no browsing to references
 * outside a shidduch's context"), not debt. It has no retiring story, no
 * `kind`, and removing an entry from it re-opens a browse surface the owner
 * closed — it is not routed through the symmetric-exemption machinery above.
 *
 * `findAd24Violations` reads NO world state from module scope — not
 * `RESOURCES`, not the live registry, not the filesystem — mirroring
 * `root/routeManifest.ts`'s `findManifestViolations` (its own doc comment:
 * "[t]akes its inputs as parameters … so tests can drive it with invalid
 * fixtures without mutating the real manifest"). The four exemption tables
 * ARE module scope (they are part of the rule definition, like
 * `RECORD_FLAG_EXEMPTIONS`), which is exactly why `exemptions` is an
 * override parameter: a test proving `stale-exemption` or
 * `permanent-exemption-for-360-entity` fires needs a table that disagrees
 * with reality, without touching the real one.
 */

// --- Violation vocabulary --------------------------------------------------

export type Ad24ViolationCode =
  | "missing-descriptor"
  | "bespoke-record-surface"
  | "modal-record-surface"
  | "non-ad24-record-path"
  | "hand-built-record-path"
  | "tab-key-unknown"
  | "tab-key-duplicated"
  | "tab-order-drift"
  | "tab-set-incomplete"
  | "stale-exemption"
  | "permanent-exemption-for-360-entity"
  | "browse-surface-on-scoped-entity"
  | "browse-surface-enumeration"
  | "unlisted-entity-missing-index";

export interface Ad24Violation {
  code: Ad24ViolationCode;
  subject: string;
  detail: string;
}

// --- The exemption model ---------------------------------------------------

export type Ad24Exemption =
  | { kind: "pending"; retiredBy: string }
  | { kind: "permanent"; reason: string };

export interface Ad24Exemptions {
  descriptorlessResources: Record<string, Ad24Exemption>;
  recordSurfaceExemptions: Record<string, Ad24Exemption>;
  modalRecordSurfaces: Record<string, Ad24Exemption>;
  pendingRouteShapes: Record<string, Ad24Exemption>;
}

/**
 * AC 2. At the close of Epic 3, `inbox_items`/`tasks`/`members` are the only
 * resources with no registered descriptor — Epic 3 registers descriptors
 * for the four AD-24 entities only. All three are `permanent`: none of them
 * is an AD-24 entity (Epic 3 preflight brief §7 — "shidduchim/tasks/
 * reminders/inbox/members never migrate"), so the trigger is a genuine
 * re-decision point, not a schedule.
 */
export const DESCRIPTORLESS_RESOURCES: Record<string, Ad24Exemption> = {
  inbox_items: {
    kind: "permanent",
    reason:
      "Triage surface (InboxList.tsx), not a primary record entity — cards resolve via a dialog or are dismissed, never through a 360.",
  },
  tasks: {
    kind: "permanent",
    reason:
      "A dependent row (target_type/target_id), not a subject in its own right — reached from its target's Tasks tab or the global /tasks list, never as its own record.",
  },
  members: {
    kind: "permanent",
    reason:
      "A user/profile row, not one of AD-24's four entities (shidduchim, singles, shadchanim, references).",
  },
};

/**
 * AC 3. Keyed by `"<resource>:<slot>"` for `slot` in `show | create | edit`.
 * Story 3.12 replaced `singles`/`shadchanim`/`references`' own `create:`
 * with `hasCreate: true` + `children: buildCreateRoutes(...)`, which IS the
 * AD-24-routed shape — so there is deliberately no `create` entry for any of
 * the three below (transcribing AC 3's prose literally would have shipped
 * three `stale-exemption`s on day one; verified against each `index.ts`
 * instead). `shidduchim`, `inbox_items` and `tasks` register `list` only and
 * get no entry at all. `references` is no longer here either — Story 5.10
 * migrated it onto `buildEntityRoutes` in the same diff that removed this
 * row (the last of the four AD-24 entities to do so).
 */
export const RECORD_SURFACE_EXEMPTIONS: Record<string, Ad24Exemption> = {
  "members:edit": {
    kind: "permanent",
    reason:
      "Members are not an AD-24 entity; MemberEdit is a settings-adjacent form, not a 360 record surface.",
  },
};
// NOTE (F7, Story 3-11 review): `checkExemptionTable`'s `isPermanentTrigger`
// is wired for `DESCRIPTORLESS_RESOURCES` (AC 2) only, not for this table.
// `members:edit`'s permanent entry is still backstopped: `members` is ALSO
// in `DESCRIPTORLESS_RESOURCES` (permanent), so the day `members` acquires
// a registered `EntityDescriptor`, AC 2 fires `permanent-exemption-for-360-
// entity` for `"members"` and fails the build, forcing this entry to be
// re-decided too — just via the resource-name table, not this slot-keyed
// one. The coupling is real but implicit; recorded here so it is not
// mistaken for a gap.

/**
 * AC 4 (UX-DR3). Keyed by repo-relative path under `src/components/atomic-crm/`.
 * `shidduchim/ShidduchCreate.tsx` is deliberately NOT here — Story 3.13
 * converted it to the page at `/shidduchim/new` before this story landed.
 * `shidduchim/ShidduchShow.tsx` (the routed dialog) is also NOT here any
 * more — Story 5.1 deleted it in the same diff that removed this row.
 */
export const MODAL_RECORD_SURFACES: Record<string, Ad24Exemption> = {
  "tasks/TaskEdit.tsx": {
    kind: "permanent",
    reason:
      "A task is not an AD-24 entity (no descriptor, no UX-DR5 tab row, no 360); it is a dependent row edited inline, the same category as a confirm dialog. Auto-invalidated (AC 2) the moment `tasks` acquires a descriptor.",
  },
};
// NOTE (F7, Story 3-11 review): same backstop as RECORD_SURFACE_EXEMPTIONS'
// `members:edit` above — `checkExemptionTable`'s `isPermanentTrigger` is not
// wired for this table either, but `tasks` is ALSO permanent in
// `DESCRIPTORLESS_RESOURCES`, so AC 2 independently fails the build the
// moment `tasks` gets a descriptor.

/**
 * AC 5a. Keyed by resource name. All four AD-24 entities have now flipped
 * `buildRecordPath` to the bare AD-24 shape, each in the same diff that
 * removed its own row here: `shidduchim` (5.1), `singles` (5.8),
 * `shadchanim` (5.9), and `references` (5.10, the last of the four). Empty
 * on purpose — there is no fifth AD-24 entity pending migration.
 */
export const PENDING_ROUTE_SHAPES: Record<string, Ad24Exemption> = {};

/** Bundles the four exemption tables above — the default value of
 * `findAd24Violations`' `exemptions` parameter. There is no fifth,
 * `STUB_DESCRIPTORS` table: AC 6 is exemption-free (see below). */
export const AD24_EXEMPTIONS: Ad24Exemptions = {
  descriptorlessResources: DESCRIPTORLESS_RESOURCES,
  recordSurfaceExemptions: RECORD_SURFACE_EXEMPTIONS,
  modalRecordSurfaces: MODAL_RECORD_SURFACES,
  pendingRouteShapes: PENDING_ROUTE_SHAPES,
};

/**
 * AC 10 (RULING 7 — project owner, standing). NOT an exemption: it carries
 * no `kind`, is not bundled into `Ad24Exemptions`, and is not passed through
 * the symmetric-exemption helper below. A `permanent` entry auto-invalidates
 * the moment its resource acquires a descriptor — but `references` already
 * HAS one, so writing this as `kind: "permanent"` would self-invalidate on
 * the day it was written. No-browse is a statement about reachability,
 * never about whether the entity gets a 360.
 *
 * There is no allowlist for `references` in `browse-surface-on-scoped-entity`
 * itself and none may be added: this rule is unconditional from the day it
 * is written. It goes green only once Story 4.4 (Navigation set) removes
 * `/references` from `PRIMARY_NAV`, the mobile "More" item, both dashboard
 * tiles and the tour step — all outside this story's scope boundary.
 */
export const NO_BROWSE_SURFACE_ENTITIES: Record<string, string> = {
  references:
    "RULING 7: a reference exists only within a shidduch's context. It keeps a full 360 at /references/{id} and shows every shidduch it serves from inside its own record; it has no nav entry, no list, no dashboard tile, no tour step and no global-search results. This is a product decision, not a security boundary — RLS stays deliberately account-wide (FR51) and must not be narrowed to enforce it.",
};

// --- AC 6 — the canonical per-entity tab matrix ----------------------------

/**
 * UX-DR5's per-entity tab matrix, ordered and typed against `TabKey`
 * (contract §3 rule 5). Widening a row is a one-line edit made BY the story
 * that needs the key, in the SAME diff as adding it to that descriptor's
 * `tabs` (moving it out of `pendingTabs`) — exactly as for `TAB_KEYS`
 * itself. `7-1` adds `discussions` to the `shidduchim` row; `8-5` adds the
 * `connections` row. Neither is Epic 3 work.
 */
export const CANONICAL_TAB_SETS: Partial<Record<string, readonly TabKey[]>> = {
  shidduchim: [
    "overview",
    "resume",
    "photo",
    "medical",
    "files",
    "diligence",
    "external-links",
    "notes",
    "tasks",
    "activity",
    "discussions",
  ],
  singles: [
    "overview",
    "resume",
    "photo",
    "files",
    "shidduchim",
    "notes",
    "tasks",
    "activity",
  ],
  shadchanim: ["overview", "shidduchim", "notes", "tasks", "activity"],
  references: [
    "overview",
    "conversations",
    "shidduchim",
    "notes",
    "tasks",
    "activity",
    "assistant",
  ],
};

// --- Shared symmetric-exemption helper (AC 2-5) ----------------------------

/**
 * The one symmetric check shared by the four exemption-backed rules
 * (AC 2-5) — writing it four times is the DRY violation this file is most
 * likely to acquire otherwise. `offenders` is the current, caller-computed
 * set of keys that break the rule; `exemptions` is the written table.
 *
 * `isPermanentTrigger`/`permanentTriggerDetail` are AC 2's mechanism only
 * (the callers for AC 3-5 simply omit them): when a NON-offending table
 * entry is `kind: "permanent"` AND the trigger predicate says its resource
 * has crossed into 360-entity territory, this reports
 * `permanent-exemption-for-360-entity` instead of the generic
 * `stale-exemption` — the mechanically-enforced re-decision point behind
 * every deferral in this story.
 */
/** Renders an exemption's own metadata into a violation's `detail`, so the
 * reader of a `stale-exemption` / `permanent-exemption-for-360-entity`
 * message can see which story owns the entry (or why it is permanent)
 * without cross-referencing the table by hand — the single most useful
 * field in it was previously write-only (F8, Story 3-11 review). */
function formatExemption(exemption: Ad24Exemption): string {
  return exemption.kind === "pending"
    ? `pending, retiredBy: "${exemption.retiredBy}"`
    : `permanent, reason: "${exemption.reason}"`;
}

function checkExemptionTable(params: {
  offenders: string[];
  exemptions: Record<string, Ad24Exemption>;
  offenderCode: Ad24ViolationCode;
  offenderDetail: (key: string) => string;
  staleDetail: (key: string, exemption: Ad24Exemption) => string;
  isPermanentTrigger?: (key: string) => boolean;
  permanentTriggerDetail?: (key: string) => string;
}): Ad24Violation[] {
  const violations: Ad24Violation[] = [];
  const offenderSet = new Set(params.offenders);

  for (const key of params.offenders) {
    if (!(key in params.exemptions)) {
      violations.push({
        code: params.offenderCode,
        subject: key,
        detail: params.offenderDetail(key),
      });
    }
  }

  for (const [key, exemption] of Object.entries(params.exemptions)) {
    if (offenderSet.has(key)) continue;
    if (exemption.kind === "permanent" && params.isPermanentTrigger?.(key)) {
      violations.push({
        code: "permanent-exemption-for-360-entity",
        subject: key,
        detail:
          params.permanentTriggerDetail?.(key) ??
          params.staleDetail(key, exemption),
      });
      continue;
    }
    violations.push({
      code: "stale-exemption",
      subject: key,
      detail: params.staleDetail(key, exemption),
    });
  }

  return violations;
}

// --- AC 2 — missing-descriptor ---------------------------------------------

function findMissingDescriptorViolations(
  resources: ResourceEntry[],
  descriptors: Map<string, EntityDescriptor>,
  descriptorlessResources: Record<string, Ad24Exemption>,
): Ad24Violation[] {
  const resourceNames = new Set(resources.map((r) => r.name));
  const offenders = resources
    .filter((r) => !descriptors.has(r.name))
    .map((r) => r.name);

  return checkExemptionTable({
    offenders,
    exemptions: descriptorlessResources,
    offenderCode: "missing-descriptor",
    offenderDetail: (name) =>
      `resource "${name}" has no registered EntityDescriptor and no DESCRIPTORLESS_RESOURCES entry`,
    staleDetail: (name, exemption) =>
      resourceNames.has(name)
        ? `DESCRIPTORLESS_RESOURCES names "${name}" (${formatExemption(exemption)}), which now has a registered EntityDescriptor`
        : `DESCRIPTORLESS_RESOURCES names "${name}" (${formatExemption(exemption)}), which is not a registered resource`,
    isPermanentTrigger: (name) => descriptors.has(name),
    permanentTriggerDetail: (name) =>
      `DESCRIPTORLESS_RESOURCES marks "${name}" permanent, but it now has a registered EntityDescriptor — the deferral must be re-decided, not inherited`,
  });
}

// --- AC 3 — bespoke-record-surface ------------------------------------------

const RECORD_SURFACE_SLOTS = ["show", "create", "edit"] as const;

function findBespokeRecordSurfaceViolations(
  resources: ResourceEntry[],
  recordSurfaceExemptions: Record<string, Ad24Exemption>,
): Ad24Violation[] {
  const declaredKeys = new Set<string>();
  const offenders: string[] = [];

  for (const resource of resources) {
    for (const slot of RECORD_SURFACE_SLOTS) {
      const key = `${resource.name}:${slot}`;
      declaredKeys.add(key);
      if (resource.definition[slot]) offenders.push(key);
    }
  }

  return checkExemptionTable({
    offenders,
    exemptions: recordSurfaceExemptions,
    offenderCode: "bespoke-record-surface",
    offenderDetail: (key) => {
      const [name, slot] = key.split(":");
      return `resource "${name}" declares a bespoke "${slot}" surface outside buildEntityRoutes, with no RECORD_SURFACE_EXEMPTIONS entry`;
    },
    staleDetail: (key, exemption) => {
      const [name, slot] = key.split(":");
      return declaredKeys.has(key)
        ? `RECORD_SURFACE_EXEMPTIONS names "${key}" (${formatExemption(exemption)}), but resource "${name}" no longer declares a "${slot}" surface`
        : `RECORD_SURFACE_EXEMPTIONS names "${key}" (${formatExemption(exemption)}), which is not a registered resource/slot pair`;
    },
  });
}

// --- AC 4 — modal-record-surface --------------------------------------------

function findModalRecordSurfaceViolations(
  modalRecordSurfaces: string[],
  modalRecordSurfaceExemptions: Record<string, Ad24Exemption>,
): Ad24Violation[] {
  return checkExemptionTable({
    offenders: modalRecordSurfaces,
    exemptions: modalRecordSurfaceExemptions,
    offenderCode: "modal-record-surface",
    offenderDetail: (path) =>
      `"${path}" wraps a primary record surface in a <Dialog> (UX-DR3) with no MODAL_RECORD_SURFACES entry`,
    staleDetail: (path, exemption) =>
      `MODAL_RECORD_SURFACES names "${path}" (${formatExemption(exemption)}), which no longer imports <Dialog> as a record surface`,
  });
}

// --- AC 5a — non-ad24-record-path -------------------------------------------

function findNonAd24RecordPathViolations(
  descriptors: Map<string, EntityDescriptor>,
  pendingRouteShapes: Record<string, Ad24Exemption>,
): Ad24Violation[] {
  const offenders: string[] = [];

  for (const [name, descriptor] of descriptors) {
    if (descriptor.buildRecordPath(1) !== `/${name}/1`) offenders.push(name);
  }

  return checkExemptionTable({
    offenders,
    exemptions: pendingRouteShapes,
    offenderCode: "non-ad24-record-path",
    offenderDetail: (name) =>
      `descriptor "${name}".buildRecordPath(1) is "${descriptors.get(name)!.buildRecordPath(1)}", not "/${name}/1", and has no PENDING_ROUTE_SHAPES entry`,
    staleDetail: (name, exemption) =>
      descriptors.has(name)
        ? `PENDING_ROUTE_SHAPES names "${name}" (${formatExemption(exemption)}), whose buildRecordPath is already AD-24-shaped`
        : `PENDING_ROUTE_SHAPES names "${name}" (${formatExemption(exemption)}), which has no registered descriptor`,
  });
}

// --- AC 5b — hand-built-record-path -----------------------------------------

/**
 * Exactly two legitimate shapes for building a `/{entity}/{id}…` string:
 * `entity360/entityPaths.ts` itself, and a descriptor's own
 * `buildRecordPath` (any `entityDescriptor.ts`/`.tsx` — the one place a
 * record path is DECLARED). `.tsx` is matched too: Story 5.1 is the first
 * descriptor module whose region renderers need JSX
 * (`shidduchim/entityDescriptor.tsx`), and it will not be the last — 5.8 /
 * 5.9 / 5.10 each need a one-line JSX adapter over an existing header. Test/
 * guard files are excluded because they legitimately reference the shape in
 * fixtures and prose.
 */
function isPathBuilderAllowed(path: string): boolean {
  if (path.includes(".test.") || path.includes(".guard.")) return true;
  if (/(^|\/)entity360\/entityPaths\.ts$/.test(path)) return true;
  if (/\/entityDescriptor\.tsx?$/.test(path)) return true;
  return false;
}

function findHandBuiltRecordPathViolations(
  handBuiltRecordPaths: string[],
): Ad24Violation[] {
  return handBuiltRecordPaths
    .filter((path) => !isPathBuilderAllowed(path))
    .map((path) => ({
      code: "hand-built-record-path" as const,
      subject: path,
      detail: `"${path}" builds a /{entity}/{id}… string outside entity360/entityPaths.ts and outside any entityDescriptor.ts`,
    }));
}

// --- AC 6 — tab-set consistency and declared completeness ------------------

type TabOrigin = "tabs" | "pendingTabs";

function isCanonicalSubsequence(
  keys: string[],
  canonicalRow: readonly string[],
): boolean {
  let cursor = 0;
  for (const key of keys) {
    const position = canonicalRow.indexOf(key, cursor);
    if (position === -1) return false;
    cursor = position + 1;
  }
  return true;
}

function findTabSetViolations(
  descriptors: Map<string, EntityDescriptor>,
  canonicalTabSets: Partial<Record<string, readonly TabKey[]>>,
): Ad24Violation[] {
  const violations: Ad24Violation[] = [];

  for (const [name, descriptor] of descriptors) {
    const entries: { key: string; origin: TabOrigin }[] = [
      ...(descriptor.tabs ?? []).map((tab) => ({
        key: tab.key as string,
        origin: "tabs" as const,
      })),
      ...(descriptor.pendingTabs ?? []).map((key) => ({
        key: key as string,
        origin: "pendingTabs" as const,
      })),
    ];

    // (a) every key must be a member of TAB_KEYS. Rejected keys are
    // excluded from (b), (c) and (d). Deduped to a unique key set before
    // reporting (F6, Story 3-11 review): the same unknown key appearing in
    // both `tabs` and `pendingTabs` is one defect, not two — "each key is
    // reported at most once" (AC 6) applies to (a) exactly as it does to
    // (b)-(d).
    const unknownKeys = [
      ...new Set(
        entries
          .filter((entry) => !isTabKey(entry.key))
          .map((entry) => entry.key),
      ),
    ];
    for (const key of unknownKeys) {
      violations.push({
        code: "tab-key-unknown",
        subject: name,
        detail: `"${key}" is not a member of TAB_KEYS`,
      });
    }
    const known = entries.filter((entry) => isTabKey(entry.key));

    // (b) no key may appear twice, within one array or across both.
    // Duplicated keys are collapsed (deduped) before (c) and (d).
    const occurrences = new Map<string, number>();
    for (const entry of known) {
      occurrences.set(entry.key, (occurrences.get(entry.key) ?? 0) + 1);
    }
    for (const [key, count] of occurrences) {
      if (count > 1) {
        violations.push({
          code: "tab-key-duplicated",
          subject: name,
          detail: `"${key}" appears more than once across tabs/pendingTabs`,
        });
      }
    }

    const tabsKeys = [
      ...new Set(known.filter((e) => e.origin === "tabs").map((e) => e.key)),
    ];
    const pendingKeys = [
      ...new Set(
        known.filter((e) => e.origin === "pendingTabs").map((e) => e.key),
      ),
    ];

    const canonicalRow = canonicalTabSets[name];
    // `tabsKeys`/`pendingKeys` are `string[]` post-(a) filtering — TS does
    // not carry the `isTabKey` narrowing through `Set`/`Array.filter`, so
    // the canonical row is compared against as `readonly string[]` below.
    const canonicalRowStrings: readonly string[] | undefined = canonicalRow;

    // (c) relative order — a SUBSEQUENCE of the canonical row, checked
    // independently for `tabs` and `pendingTabs`, and only over keys that
    // belong to this entity's own canonical row (a key that does not
    // belong to the entity at all is (d)'s finding, not an ordering one).
    if (canonicalRow && canonicalRowStrings) {
      const tabsInRow = tabsKeys.filter((key) =>
        canonicalRowStrings.includes(key),
      );
      const pendingInRow = pendingKeys.filter((key) =>
        canonicalRowStrings.includes(key),
      );
      if (!isCanonicalSubsequence(tabsInRow, canonicalRow)) {
        violations.push({
          code: "tab-order-drift",
          subject: name,
          detail: `tabs [${tabsInRow.join(", ")}] are not in canonical relative order for "${name}"`,
        });
      }
      if (!isCanonicalSubsequence(pendingInRow, canonicalRow)) {
        violations.push({
          code: "tab-order-drift",
          subject: name,
          detail: `pendingTabs [${pendingInRow.join(", ")}] are not in canonical relative order for "${name}"`,
        });
      }
    }

    // (d) keys(tabs) ∪ pendingTabs must equal the canonical row, as SETS,
    // compared in both directions. A descriptor whose name has no
    // canonical row is reported here too, never silently skipped.
    if (!canonicalRow) {
      violations.push({
        code: "tab-set-incomplete",
        subject: name,
        detail: `"${name}" has no row in CANONICAL_TAB_SETS`,
      });
    } else {
      const union = new Set([...tabsKeys, ...pendingKeys]);
      const canonicalSet = new Set<string>(canonicalRow);
      const missing = canonicalRow.filter((key) => !union.has(key));
      const unexpected = [...union].filter((key) => !canonicalSet.has(key));
      if (missing.length > 0 || unexpected.length > 0) {
        violations.push({
          code: "tab-set-incomplete",
          subject: name,
          detail: `missing: [${missing.join(", ")}]; unexpected: [${unexpected.join(", ")}]`,
        });
      }
    }
  }

  return violations;
}

/**
 * AC 9 — the pending-tab ledger. Only entries with a non-empty
 * `pendingTabs`. Epic 5's closing story flips the informational assertion
 * over this function's output (in `ad24Conformance.test.ts`) from "returns
 * an array" to `toEqual([])` — a one-line change to an existing assertion,
 * not a new scan.
 */
export function findPendingTabs(
  descriptors: Map<string, EntityDescriptor>,
): { entity: string; pending: TabKey[] }[] {
  const ledger: { entity: string; pending: TabKey[] }[] = [];
  for (const [name, descriptor] of descriptors) {
    if (descriptor.pendingTabs && descriptor.pendingTabs.length > 0) {
      ledger.push({ entity: name, pending: descriptor.pendingTabs });
    }
  }
  return ledger;
}

// --- AC 10 — RULING 7, no browse surface for a scoped entity ---------------

/**
 * The pure matcher behind AC 10(b), unit-tested against a synthetic corpus
 * so it is falsifiable independently of what the real source tree currently
 * links. Two shapes count: a list-path LITERAL (`/${name}` immediately
 * followed by a closing quote/backtick/`?` — the path ends at that
 * segment, so `/references/${id}`, `/references/1/show` and
 * `/references/new` do NOT match), and a `buildListPath("<name>")` call
 * site. File-level exclusions (the builder itself, `*\/entityDescriptor.ts`/
 * `.tsx` — see `isPathBuilderAllowed` above, widened by Story 5.1 —
 * `<name>/index.ts`, `.test.`/`.guard.` files) are the caller's job when it
 * assembles `files` — this matcher has no path-based exclusion of its own.
 */
export function findListPathLinks(
  files: Record<string, string>,
  names: string[],
): string[] {
  const offenders: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const matches = names.some((name) => {
      // Lookbehind on the opening quote/backtick is required: without it,
      // a relative import like `"../references"` would falsely match on
      // its own trailing "/references" — this is a real path, not merely
      // "text ending in /references".
      const literal = new RegExp(`(?<=["'\`])/${name}(?=["'\`?])`);
      const call = new RegExp(`buildListPath\\(\\s*["'\`]${name}["'\`]\\s*\\)`);
      return literal.test(content) || call.test(content);
    });
    if (matches) offenders.push(path);
  }
  return offenders;
}

/**
 * The modules that ARE a browse surface by construction, identified by their
 * `atomic-crm`-relative path.
 *
 * Why a fixed list and not "every file": enumerating references is legitimate
 * in several places the ruling deliberately keeps — `settings/exportFamilyData.ts`
 * (GDPR portability), `settings/PrivacySection.tsx` (the records-held tally),
 * `references/ReferenceMergeButton.tsx` (the merge candidate picker, filtered to
 * the current record) and `references/ReferencesIndex.tsx` (RULING 7 §1a's
 * unattached panel, filtered to `linked_shidduchim_count@eq: 0`). A repo-wide
 * "no list query" rule would be red for all four and would be suppressed within
 * a week. These two surfaces are different in kind: a dashboard tile and a
 * global-search fan-out exist ONLY to put a set of records in front of a user
 * who did not name one, which is the precise thing RULING 7 forbids. On them,
 * a list query for a no-browse entity is never legitimate.
 */
const BROWSE_SURFACE_MODULE_PATTERNS: RegExp[] = [
  /^dashboard\//,
  /^misc\/[A-Za-z]*[Gg]lobalSearch[A-Za-z]*\.tsx?$/,
];

export function isBrowseSurfaceModule(path: string): boolean {
  return BROWSE_SURFACE_MODULE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The pure matcher behind the enumeration rule. Reports every browse-surface
 * module that issues a LIST query for a no-browse entity.
 *
 * This is the rule that closes the blind spot `findListPathLinks` left open.
 * The dashboard tile removed by Story 4.4 was two separate things: a
 * `to="/references"` link (which clause (b) catches) and, in
 * `dashboard/useDashboardData.ts`, a bare
 * `useGetList("references", { pagination: { page: 1, perPage: 1 } })` count
 * carrying NO path literal at all. Clause (b) is a path matcher and could not
 * see the count; a tile could therefore be reinstated with its number intact
 * and the guard would stay green. Enumeration, not linking, is what the ruling
 * is about — so this rule matches the query.
 *
 * `references_summary` is matched alongside `references` because
 * `providers/supabase/dataProvider.ts` maps the resource onto the view, and a
 * caller may name either. `useGetOne`/`useGetMany` are deliberately NOT matched:
 * fetching a record by id is addressability, which RULING 7 clause 2 protects.
 */
export function findBrowseSurfaceEnumeration(
  files: Record<string, string>,
  names: string[],
): string[] {
  const offenders: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const matches = names.some((name) =>
      // `useGetList<Foo>("references"` / `getList("references_summary"` /
      // `dataProvider.getList("references"` — an optional generic argument
      // may sit between the callee and its parentheses.
      new RegExp(
        `\\b(?:useGetList|getList)\\s*(?:<[^<>()]*>)?\\s*\\(\\s*["'\`]${name}(?:_summary)?["'\`]`,
      ).test(content),
    );
    if (matches) offenders.push(path);
  }
  return offenders;
}

/**
 * The source-shape markers that make a component a BROWSE surface. Each one
 * is a thing whose entire purpose is to put an unnamed set of records in
 * front of a user, and each is verified present in this repo:
 *
 *  - `@/components/admin/list` — ra-core's `<List>` controller: an unbounded,
 *    paginated, filterable query over a whole resource.
 *  - `EntityList` — Story 4.1's shared list chrome, built on the same.
 *  - `@/components/admin/search-input` — a free-text box over a resource,
 *    which RULING 7 names explicitly ("enumeration with a search box in
 *    front of it").
 *  - `<CreateButton` — the list's own unscoped create entry, the affordance
 *    RULING 7 clause 5 replaces with the in-shidduch CTA.
 *
 * Deliberately NOT a marker: `useGetList`. `ReferencesIndex` issues one, and
 * so must any honest recovery surface — the ruling forbids browsing, not
 * querying. See `findBrowseSurfaceEnumeration` for the query-shaped rule,
 * which is scoped to modules that exist only to browse.
 */
const BROWSE_COMPONENT_MARKERS: { pattern: RegExp; marker: string }[] = [
  {
    pattern: /from\s+["'][^"']*\/components\/admin\/list["']/,
    marker: "imports admin/list (<List>)",
  },
  { pattern: /\bEntityList\b/, marker: "renders EntityList" },
  {
    pattern: /from\s+["'][^"']*\/components\/admin\/search-input["']/,
    marker: "imports admin/search-input (free-text search)",
  },
  { pattern: /<CreateButton\b/, marker: "renders <CreateButton>" },
];

/**
 * AC 10(c) — the reachability half of RULING 7, and the clause the earlier
 * pass could not write because `ReferencesIndex` did not exist yet.
 *
 * Clauses (a)/(b)/(b2) are all about what LINKS to or COUNTS a no-browse
 * entity. None of them looks at what the entity's registered `list` actually
 * renders — so the ruling could be re-opened, with every existing assertion
 * still green, simply by pointing `references/index.ts` back at a list
 * component. Nothing would link to it and no dashboard would count it; a
 * user typing `#/references` would just get the book back.
 *
 * `indexSources` maps an entity name to the SOURCE TEXT of the module its
 * `list` slot resolves to (the guard test follows `<entity>/index.ts`'s
 * `list:` registration to the imported module, so this is reachability, not
 * a filename convention). Returns `"<name>: <marker>"` for each browse-shaped
 * one, naming the marker so the failure says what was found.
 */
export function findBrowseShapedIndexes(
  indexSources: Record<string, string>,
): string[] {
  const offenders: string[] = [];
  for (const [name, source] of Object.entries(indexSources)) {
    const hit = BROWSE_COMPONENT_MARKERS.find(({ pattern }) =>
      pattern.test(source),
    );
    if (hit) offenders.push(`${name}: ${hit.marker}`);
  }
  return offenders;
}

function findNoBrowseSurfaceViolations(
  resources: ResourceEntry[],
  navTargets: string[],
  listPathLinks: string[],
  browseSurfaceEnumerations: string[],
  browseShapedIndexes: string[],
  noBrowseSurfaceEntities: Record<string, string>,
): Ad24Violation[] {
  const violations: Ad24Violation[] = [];
  const resourceNames = new Set(resources.map((r) => r.name));
  const noBrowseNames = Object.keys(noBrowseSurfaceEntities);

  // (a) no PRIMARY_NAV target may resolve to a no-browse entity.
  for (const name of noBrowseNames) {
    const prefix = `/${name}`;
    for (const target of navTargets) {
      if (target === prefix || target.startsWith(`${prefix}/`)) {
        violations.push({
          code: "browse-surface-on-scoped-entity",
          subject: name,
          detail: `PRIMARY_NAV target "${target}" resolves to no-browse entity "${name}" (RULING 7)`,
        });
      }
    }
  }

  // (b) no file may link to a no-browse entity's list path.
  // NOTE (F9, Story 3-11 review): `detail` names every no-browse entity,
  // not specifically the one `file` matched — `listPathLinks` is a pinned
  // `string[]` (AC 1's signature), carrying no (file, entity) pairing, so
  // there is nothing more specific to name without widening that contract.
  // Harmless today (exactly one entry, `references`); revisit the moment a
  // second `NO_BROWSE_SURFACE_ENTITIES` row is added.
  for (const file of listPathLinks) {
    violations.push({
      code: "browse-surface-on-scoped-entity",
      subject: file,
      detail: `"${file}" links to the list path of a no-browse entity (${noBrowseNames.join(", ")}) — RULING 7 forbids a browse surface for it`,
    });
  }

  // (b2) no dashboard tile and no global-search fan-out may enumerate a
  // no-browse entity. Distinct from (b): (b) matches a PATH, this matches a
  // QUERY, and the surface the owner reported ("why is there references in
  // dashboard") was a count with no path at all.
  for (const file of browseSurfaceEnumerations) {
    violations.push({
      code: "browse-surface-enumeration",
      subject: file,
      detail: `"${file}" is a browse surface (dashboard or global search) and issues a list query for a no-browse entity (${noBrowseNames.join(", ")}) — RULING 7 forbids enumerating it there, with or without a link`,
    });
  }

  // (c) every resource NOT in the table must declare a list — dropping
  // `list` is not a legal way to express "no browse surface".
  for (const resource of resources) {
    if (resource.name in noBrowseSurfaceEntities) continue;
    if (!resource.definition.list) {
      violations.push({
        code: "unlisted-entity-missing-index",
        subject: resource.name,
        detail: `resource "${resource.name}" declares no list and is not in NO_BROWSE_SURFACE_ENTITIES`,
      });
    }
  }

  // (c2) …and a resource that IS in the table must not register a BROWSE
  // component in that `list` slot. This is the other half of (c): (c) says
  // the slot must be filled, this says what may fill it. Without it the
  // ruling is enforced only against links and counts, and re-pointing
  // `references/index.ts` back at `ReferenceList` would leave every other
  // assertion in this file green.
  for (const offender of browseShapedIndexes) {
    const name = offender.split(":")[0];
    if (!(name in noBrowseSurfaceEntities)) continue;
    violations.push({
      code: "browse-surface-on-scoped-entity",
      subject: name,
      detail: `the index registered as "${name}"'s \`list\` is a browse component (${offender}) — RULING 7 forbids a browse surface for it; the slot is the route mount and must hold a non-browse index`,
    });
  }

  // (d) every key in the table must name a resource that still exists. No
  // `kind`, so no `permanent-exemption-for-360-entity` direction here.
  for (const name of noBrowseNames) {
    if (!resourceNames.has(name)) {
      violations.push({
        code: "stale-exemption",
        subject: name,
        detail: `NO_BROWSE_SURFACE_ENTITIES names "${name}", which is not a registered resource`,
      });
    }
  }

  return violations;
}

// --- The validator -----------------------------------------------------------

/**
 * Pure, parameter-driven (contract with `root/routeManifest.ts`'s
 * `findManifestViolations`, `root/routeManifest.ts:168-179`): never reads
 * `RESOURCES`, the live registry, or the filesystem from module scope, so
 * tests drive every one of the 13 `Ad24ViolationCode`s with a fixture that
 * breaks exactly one rule, without mutating the real manifest or registry.
 */
export function findAd24Violations(input: {
  resources: ResourceEntry[];
  descriptors: Map<string, EntityDescriptor>;
  modalRecordSurfaces: string[];
  handBuiltRecordPaths: string[];
  navTargets: string[];
  listPathLinks: string[];
  /** Browse-surface modules issuing a list query for a no-browse entity
   * (`findBrowseSurfaceEnumeration`). Optional so the many single-rule
   * fixtures stay isolated; the real guard always passes it. */
  browseSurfaceEnumerations?: string[];
  /** `"<entity>: <marker>"` for each entity whose registered `list` module is
   * a browse component (`findBrowseShapedIndexes`). Optional so the many
   * single-rule fixtures stay isolated; the real guard always passes it. */
  browseShapedIndexes?: string[];
  exemptions?: Ad24Exemptions;
  noBrowseSurfaceEntities?: Record<string, string>;
}): Ad24Violation[] {
  const exemptions = input.exemptions ?? AD24_EXEMPTIONS;
  const noBrowseSurfaceEntities =
    input.noBrowseSurfaceEntities ?? NO_BROWSE_SURFACE_ENTITIES;

  return [
    ...findMissingDescriptorViolations(
      input.resources,
      input.descriptors,
      exemptions.descriptorlessResources,
    ),
    ...findBespokeRecordSurfaceViolations(
      input.resources,
      exemptions.recordSurfaceExemptions,
    ),
    ...findModalRecordSurfaceViolations(
      input.modalRecordSurfaces,
      exemptions.modalRecordSurfaces,
    ),
    ...findNonAd24RecordPathViolations(
      input.descriptors,
      exemptions.pendingRouteShapes,
    ),
    ...findHandBuiltRecordPathViolations(input.handBuiltRecordPaths),
    ...findTabSetViolations(input.descriptors, CANONICAL_TAB_SETS),
    ...findNoBrowseSurfaceViolations(
      input.resources,
      input.navTargets,
      input.listPathLinks,
      input.browseSurfaceEnumerations ?? [],
      input.browseShapedIndexes ?? [],
      noBrowseSurfaceEntities,
    ),
  ];
}

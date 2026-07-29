import { PRIMARY_NAV } from "../layout/navItems";
import { RESOURCES } from "../root/routeManifest";
import { ENTITY_TARGET_TYPES } from "../types";
import {
  findAd24Violations,
  findBrowseSurfaceEnumeration,
  findListPathLinks,
  isBrowseSurfaceModule,
  MODAL_RECORD_SURFACES,
  NO_BROWSE_SURFACE_ENTITIES,
} from "./ad24Conformance";
import type { EntityDescriptor } from "./entityDescriptor";
import { PENDING_DB_WIDENINGS } from "./pendingDbWidenings";
import { getEntityDescriptor } from "./registry";

/**
 * The source + SQL scanning half of the AD-24 conformance guard (Story
 * 3-11, Task 4). `ad24Conformance.test.ts` is pure and fixture-driven;
 * everything here reads REAL text via Vite's `import.meta.glob({query:
 * "?raw"})` — the one in-repo precedent is
 * `references/entitlementGate.guard.test.ts` — and hands the results to
 * `findAd24Violations` as its scan-derived parameters (`modalRecordSurfaces`,
 * `handBuiltRecordPaths`, `navTargets`, `listPathLinks`).
 *
 * Every alternation below is built from `RESOURCES` at test time, never a
 * hard-coded name list — a four-name literal is the exact defect that made
 * an earlier guard unfalsifiable (Epic 3 preflight brief §6, item 15). This
 * file also excludes its OWN sibling, `ad24Conformance.ts`: that module's
 * doc comments and exemption-table `detail` strings legitimately mention
 * paths like "shidduchim/ShidduchShow.tsx" and "/references/${id}" in prose,
 * which would otherwise register as false positives in the very scans it
 * defines.
 *
 * Hand-off notes (Task 6):
 * (a) An Epic 5 story that migrates an entity onto Entity360 MUST delete
 *     that entity's rows in the four exemption tables (`ad24Conformance.ts`)
 *     in the SAME diff that fixes the underlying resource — the symmetric
 *     exemption check (`checkExemptionTable`) fails the build otherwise.
 * (b) A story that builds a tab moves that key from `pendingTabs` into
 *     `tabs` in the same diff it lands — AC 6(d) fails the build otherwise.
 * (c) Epic 5's closing story flips the informational `findPendingTabs`
 *     assertion in `ad24Conformance.test.ts` (AC 9b) to
 *     `expect(findPendingTabs(realRegistry)).toEqual([])` — a one-line
 *     change to an existing assertion, not a new scan.
 * (d) `NO_BROWSE_SURFACE_ENTITIES` is a STANDING OWNER RULING (RULING 7 —
 *     "references only exist as part of an individual shidduch and cannot
 *     be browsed separately … no browsing to references outside a
 *     shidduch's context"), not debt. It has no retiring story; removing an
 *     entry re-opens a browse surface the owner closed.
 */

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sqlSources = import.meta.glob("../../../../supabase/schemas/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Repo-relative-to-`atomic-crm` path, matching the shape every
 * `ad24Conformance.ts` exemption table key uses. The glob root is this
 * file's own directory (`entity360/`), one level inside `atomic-crm/`. */
const toAtomicCrmRelativePath = (globKey: string): string =>
  globKey.replace(/^\.\.\//, "");

const isTestOrGuardFile = (path: string): boolean =>
  path.includes(".test.") || path.includes(".guard.");

/** This guard's own sibling — excluded from every scan below (see header
 * comment). */
const isSelf = (path: string): boolean => path.endsWith("ad24Conformance.ts");

const scannedFiles = Object.fromEntries(
  Object.entries(sources)
    .map(([key, content]) => [toAtomicCrmRelativePath(key), content] as const)
    .filter(([path]) => !isTestOrGuardFile(path) && !isSelf(path)),
);

// --- Resource name -> directory mapping (Task 4) ---------------------------

/** `inbox_items` lives in `inbox/` — the one place a resource's directory
 * is not its name. Mapped explicitly, never assumed. */
const RESOURCE_DIRECTORY_OVERRIDES: Record<string, string> = {
  inbox_items: "inbox",
};

function resourceDirectory(name: string): string {
  return RESOURCE_DIRECTORY_OVERRIDES[name] ?? name;
}

describe("resourceDirectory — name-to-directory mapping (Task 4)", () => {
  it("maps inbox_items to inbox/, and every other resource to its own name", () => {
    // Arrange / Act / Assert
    expect(resourceDirectory("inbox_items")).toBe("inbox");
    for (const name of RESOURCES.map((r) => r.name)) {
      if (name === "inbox_items") continue;
      expect(resourceDirectory(name)).toBe(name);
    }
  });
});

const RESOURCE_NAMES = RESOURCES.map((r) => r.name);
const RESOURCE_DIRECTORIES = RESOURCE_NAMES.map(resourceDirectory);

// --- AC 8 — sanity checks, one per scan, so no scan can pass vacuously -----

describe("AD-24 conformance guard — scan sanity (AC 8)", () => {
  it("the .ts/.tsx glob resolves a large, real set of files", () => {
    // Assert — if this ever fails, the glob stopped matching and every
    // assertion below would be vacuously green.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("the .ts/.tsx glob includes the known modal record surface ShidduchShow.tsx", () => {
    // Assert
    expect(
      Object.keys(scannedFiles).includes("shidduchim/ShidduchShow.tsx"),
    ).toBe(true);
  });

  it("the SQL glob resolves non-empty text containing the tasks table DDL", () => {
    // Arrange
    const tablesSql = Object.values(sqlSources)[0];

    // Assert — the literal on `main`; re-verified against the tree before
    // writing this needle (a bare `create table public.<name> (` shape, not
    // `create table if not exists`).
    expect(tablesSql).toBeTruthy();
    expect(tablesSql).toContain("create table public.tasks (");
  });
});

// --- AC 4 — modal-record-surface (real scan) --------------------------------

const RECORD_SURFACE_BASENAME = /(Show|Create|Edit)\.tsx$/;

function isInResourceDirectory(path: string): boolean {
  return RESOURCE_DIRECTORIES.some((dir) => path.startsWith(`${dir}/`));
}

const modalRecordSurfaces = Object.entries(scannedFiles)
  .filter(
    ([path, content]) =>
      isInResourceDirectory(path) &&
      RECORD_SURFACE_BASENAME.test(path.split("/").pop() ?? path) &&
      /<Dialog/.test(content),
  )
  .map(([path]) => path);

describe("AD-24 conformance guard — modal record surfaces (AC 4)", () => {
  it("finds exactly the files named in MODAL_RECORD_SURFACES — the real scan matches the real table", () => {
    // Assert
    expect(new Set(modalRecordSurfaces)).toEqual(
      new Set(Object.keys(MODAL_RECORD_SURFACES)),
    );
  });

  it("the real scan matches MODAL_RECORD_SURFACES exactly, in both directions", () => {
    // Act — empty resources/descriptors here would make every OTHER real
    // exemption table (DESCRIPTORLESS_RESOURCES, RECORD_SURFACE_EXEMPTIONS,
    // PENDING_ROUTE_SHAPES) look stale too, since none of their named
    // resources would exist; this test cares about MODAL_RECORD_SURFACES
    // only, so it filters to that table's two possible codes.
    const violations = findAd24Violations({
      resources: [],
      descriptors: new Map(),
      modalRecordSurfaces,
      handBuiltRecordPaths: [],
      navTargets: [],
      listPathLinks: [],
    });
    const modalRecordSurfaceNames = new Set(Object.keys(MODAL_RECORD_SURFACES));

    // Assert
    expect(
      violations.filter(
        (v) =>
          v.code === "modal-record-surface" ||
          (v.code === "stale-exemption" &&
            modalRecordSurfaceNames.has(v.subject)),
      ),
    ).toEqual([]);
  });
});

// --- AC 5b — hand-built-record-path (real scan) -----------------------------

const handBuiltRecordPaths = Object.entries(scannedFiles)
  .filter(([, content]) =>
    RESOURCE_NAMES.some((name) => new RegExp(`/${name}/\\$\\{`).test(content)),
  )
  .map(([path]) => path);

describe("AD-24 conformance guard — hand-built record paths (AC 5b)", () => {
  it("finds no site outside entityPaths.ts / entityDescriptor.ts building a record path by template literal", () => {
    // Act
    const violations = findAd24Violations({
      resources: [],
      descriptors: new Map(),
      modalRecordSurfaces: [],
      handBuiltRecordPaths,
      navTargets: [],
      listPathLinks: [],
    });

    // Assert — Task 5's fix (ShidduchCatchSection.tsx) removed the one site
    // 3.9's own sweep could not reach; nothing should remain.
    expect(
      violations.filter((v) => v.code === "hand-built-record-path"),
    ).toEqual([]);
  });
});

// --- AC 7 — polymorphic target-type parity ---------------------------------

/** Parses the quoted value list out of `constraint <name> check (target_type
 * in (...))`. Independent of `pendingDbWidenings.test.ts`'s own copy — this
 * AC lives wholly in this guard test, per the story's own instruction. */
function extractTargetTypeValues(
  sql: string,
  constraintName: string,
): string[] | undefined {
  const pattern = new RegExp(
    `constraint\\s+${constraintName}\\s+check\\s*\\(\\s*target_type\\s+in\\s*\\(([^)]*)\\)`,
    "i",
  );
  const match = pattern.exec(sql);
  if (!match) return undefined;
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value.length > 0);
}

function isAtParity(values: string[]): boolean {
  const entityTypes: readonly string[] = ENTITY_TARGET_TYPES;
  return (
    values.every((value) => entityTypes.includes(value)) &&
    entityTypes.every((value) => values.includes(value))
  );
}

// Deliberately the three constraints contract §8 rule 1 names, not a
// blanket "every *_target_type_check" scan — identity_signals_target_type_check
// is a different (AD-5) vocabulary that includes 'date_record'.
const TARGET_TYPE_CONSTRAINTS = [
  "tasks_target_type_check",
  "interactions_target_type_check",
  "entity_files_target_type_check",
] as const;

/**
 * Every named constraint not (yet) excused by `PENDING_DB_WIDENINGS`. A
 * constraint this scan expects to find but cannot locate — renamed, or
 * dropped without updating `TARGET_TYPE_CONSTRAINTS` or the pending ledger
 * — is itself an offender, not silently skipped (F1, Story 3-11 review): AC
 * 7 requires "all three constraints ... list a value set equal to
 * ENTITY_TARGET_TYPES", with no stated exception for "or the scan couldn't
 * find it". `sql` defaults to the real schema source; a test overrides it to
 * prove a rename is actually caught, without touching the real schema.
 */
function findTargetTypeOffenders(
  pendingWidenings: readonly string[],
  sql: string,
): string[] {
  const offenders: string[] = [];
  for (const name of TARGET_TYPE_CONSTRAINTS) {
    if (pendingWidenings.includes(name)) continue;
    const values = extractTargetTypeValues(sql, name);
    if (!values) {
      offenders.push(name);
      continue;
    }
    if (!isAtParity(values)) offenders.push(name);
  }
  return offenders;
}

describe("AD-24 conformance guard — target-type parity (AC 7)", () => {
  it("PENDING_DB_WIDENINGS is empty — Epic 3 cannot close with target types still pending", () => {
    // Assert
    expect(PENDING_DB_WIDENINGS).toEqual([]);
  });

  it("every named target-type check constraint is at full parity with ENTITY_TARGET_TYPES", () => {
    // Arrange
    const tablesSql = Object.values(sqlSources)[0];

    // Act
    const offenders = findTargetTypeOffenders(PENDING_DB_WIDENINGS, tablesSql);

    // Assert
    expect(offenders).toEqual([]);
  });

  it("reports a renamed constraint as an offender rather than silently skipping it (F1, Story 3-11 review)", () => {
    // Arrange — tasks_target_type_check renamed to tasks_tt_check; the
    // other two constraints untouched and at parity. Proves
    // findTargetTypeOffenders cannot pass vacuously against a constraint it
    // fails to locate, the way a bare `continue` did before this fix.
    const renamedSql = `
      constraint tasks_tt_check check (
          target_type in ('shadchan', 'shidduch', 'reference', 'single')
      )
      constraint interactions_target_type_check check (
          target_type in ('reference', 'shidduch', 'shadchan', 'single')
      )
      constraint entity_files_target_type_check check (
          target_type in ('reference', 'shidduch', 'shadchan', 'single')
      )
    `;

    // Act
    const offenders = findTargetTypeOffenders([], renamedSql);

    // Assert
    expect(offenders).toEqual(["tasks_target_type_check"]);
  });

  it("'connection' (Epic 8's future value) is not yet present in ENTITY_TARGET_TYPES", () => {
    // Assert — guards against silently widening ahead of Epic 8.
    expect(
      (ENTITY_TARGET_TYPES as readonly string[]).includes("connection"),
    ).toBe(false);
  });
});

// --- AC 10(b) — list-path links (real scan) ---------------------------------

const noBrowseNames = Object.keys(NO_BROWSE_SURFACE_ENTITIES);

/** Excluded from the AC 10(b) scan: the builder itself, every descriptor
 * module (a descriptor legitimately declares `/${name}` inside
 * `buildRecordPath`/`buildListPath` call sites it does not itself call),
 * and each resource's own route-mount `index.ts`. */
function isExcludedFromListPathScan(path: string): boolean {
  if (path === "entity360/entityPaths.ts") return true;
  if (/\/entityDescriptor\.ts$/.test(path)) return true;
  if (RESOURCE_DIRECTORIES.some((dir) => path === `${dir}/index.ts`)) {
    return true;
  }
  return false;
}

const listPathLinkFiles = Object.fromEntries(
  Object.entries(scannedFiles).filter(
    ([path]) => !isExcludedFromListPathScan(path),
  ),
);

const listPathLinks = findListPathLinks(listPathLinkFiles, noBrowseNames);

describe("AD-24 conformance guard — no-browse list-path links (AC 10b)", () => {
  it("finds no file linking to a no-browse entity's list path — RULING 7 is fully applied on main", () => {
    // Assert — Story 4.4 (Navigation set) removed every PRIMARY_NAV entry,
    // dashboard tile and mobile "More" item naming a no-browse entity's list
    // path. No file in the tree links to one any more.
    expect(new Set(listPathLinks)).toEqual(new Set());
  });
});

// --- Enumeration on a browse surface (real scan) ---------------------------

/** Dashboard + global-search modules only — `isBrowseSurfaceModule` carries
 * the reasoning for why the rule is scoped rather than repo-wide. */
const browseSurfaceFiles = Object.fromEntries(
  Object.entries(scannedFiles).filter(([path]) => isBrowseSurfaceModule(path)),
);

const browseSurfaceEnumerations = findBrowseSurfaceEnumeration(
  browseSurfaceFiles,
  noBrowseNames,
);

describe("AD-24 conformance guard — no-browse enumeration on a browse surface", () => {
  it("scans a non-empty set of browse-surface modules", () => {
    // Assert — a rule that silently scans nothing is the failure mode this
    // whole exercise exists to prevent. Pin that the glob actually resolves
    // the dashboard and the global-search hook.
    expect(Object.keys(browseSurfaceFiles)).toEqual(
      expect.arrayContaining([
        "dashboard/useDashboardData.ts",
        "dashboard/Dashboard.tsx",
        "dashboard/MobileDashboard.tsx",
        "misc/useGlobalSearch.ts",
      ]),
    );
  });

  it("finds no dashboard tile or search fan-out enumerating a no-browse entity", () => {
    // Assert — Story 4.4 removed `totalReferences` from `useDashboardData`
    // and both tiles; Story 4.5 kept references out of the search fan-out.
    // Unlike the list-path scan, this assertion would have caught the
    // reference COUNT that shipped to production without any `/references`
    // link beside it.
    expect(new Set(browseSurfaceEnumerations)).toEqual(new Set());
  });
});

// --- The combined real check -------------------------------------------------

describe("findAd24Violations — real manifest, registry and scans (Task 4/6)", () => {
  it("reports no AD-24 violations on main — RULING 7 is fully closed (Story 4.4)", () => {
    // Arrange
    const descriptors = new Map(
      RESOURCES.map((r): [string, EntityDescriptor | undefined] => [
        r.name,
        getEntityDescriptor(r.name),
      ]).filter(
        (entry): entry is [string, EntityDescriptor] => entry[1] !== undefined,
      ),
    );
    const navTargets = PRIMARY_NAV.map((item) => item.to);

    // Act
    const violations = findAd24Violations({
      resources: RESOURCES,
      descriptors,
      modalRecordSurfaces,
      handBuiltRecordPaths,
      navTargets,
      listPathLinks,
      browseSurfaceEnumerations,
    });

    // Assert — every AD-24 rule, including RULING 7
    // (browse-surface-on-scoped-entity), is clean on main now that Story 4.4
    // removed the `/references` PRIMARY_NAV entry, the mobile "More" item
    // and both dashboard tiles naming a no-browse entity's list path.
    expect(violations).toEqual([]);
  });
});

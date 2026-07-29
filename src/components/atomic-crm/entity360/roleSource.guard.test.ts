import { describe, expect, it } from "vitest";

/**
 * Story 3.4 AC 4 — proves the role-source seam: `useMyContexts` is read
 * from exactly one place inside `entity360/` (`useViewerRole.ts`), and
 * `administrator`, `useGetIdentity` and `minVisibility` (AC 1's retired
 * name) appear nowhere in this directory at all. Same `import.meta.glob`
 * `?raw` shape as the one in-repo precedent,
 * `references/entitlementGate.guard.test.ts`.
 *
 * The scan excludes `.test.` and `.guard.` paths, exactly like that
 * precedent, and the exclusion is load-bearing here, not tidiness: this
 * story's own `visibility.types.test.ts` and `visibility.test.ts` must
 * spell every `MemberRole` literal (AC 1a / AC 2), and 3.3a's
 * `entityDescriptor.test.ts` carries a deliberate `@ts-expect-error` case
 * literally naming `minVisibility`. Scanning test files would make this
 * guard fire on the very assertions that prove the retired name is
 * rejected.
 *
 * **The scan must first prove it scanned something.** An empty or
 * mis-rooted glob makes every "appears nowhere" assertion pass vacuously —
 * exactly how a guard over a directory that does not yet exist reports
 * green. Before any absence assertion, this file asserts the glob result
 * contains this story's own files.
 */

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// This file lives IN `entity360/`, so the `../` glob's matches inside this
// same directory (and its subdirectories, e.g. `tabs/`) normalize back to a
// bare `./…` key — `../entity360/visibility.ts` collapses to `./visibility
// .ts`. Only a file OUTSIDE `entity360/` keeps a `../` prefix. `./` is
// therefore the exact, sufficient test for "this is one of entity360/'s own
// files" — verified against the real glob output, not assumed.
const entity360Sources = Object.entries(sources).filter(([path]) =>
  path.startsWith("./"),
);

const nonTestEntity360Sources = entity360Sources.filter(
  ([path]) => !path.includes(".test.") && !path.includes(".guard."),
);

/** The matcher AC 4 requires as an exported pure function, proven red
 * against three synthetic fixtures below before it is ever trusted green. */
export function findForbiddenRoleSources(
  files: Record<string, string>,
): string[] {
  const offenders: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (/\buseGetIdentity\b/.test(content)) {
      offenders.push(path);
      continue;
    }
    if (/\badministrator\b/.test(content)) {
      offenders.push(path);
      continue;
    }
    if (/\bminVisibility\b/.test(content)) {
      offenders.push(path);
    }
  }
  return offenders;
}

describe("roleSource guard — the scan itself is falsifiable", () => {
  it("finds this story's own files, at minimum ./visibility.ts and ./useViewerRole.ts", () => {
    // Assert — proves the glob is rooted correctly and non-empty BEFORE any
    // "appears nowhere" assertion below is allowed to mean anything.
    const paths = entity360Sources.map(([path]) => path);
    expect(paths.some((path) => path.endsWith("/visibility.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/useViewerRole.ts"))).toBe(true);
  });

  it("findForbiddenRoleSources is red against each of the three synthetic broken fixtures", () => {
    // Arrange / Act / Assert — proven red before it is ever shown green.
    expect(
      findForbiddenRoleSources({
        "./Bad.tsx": "const { identity } = useGetIdentity();",
      }),
    ).toEqual(["./Bad.tsx"]);
    expect(
      findForbiddenRoleSources({
        "./Bad.tsx": "if (member.administrator) {}",
      }),
    ).toEqual(["./Bad.tsx"]);
    expect(
      findForbiddenRoleSources({
        "./Bad.tsx": "type T = { minVisibility?: MemberRole[] };",
      }),
    ).toEqual(["./Bad.tsx"]);
  });

  it("findForbiddenRoleSources is green against a clean fixture", () => {
    expect(
      findForbiddenRoleSources({
        "./Good.tsx": "export const x = hasVisibility(tab.visibleTo, role);",
      }),
    ).toEqual([]);
  });
});

describe("roleSource guard — administrator / useGetIdentity / minVisibility appear nowhere in entity360/ (non-test files)", () => {
  it("reports zero offenders", () => {
    // Arrange
    const files = Object.fromEntries(nonTestEntity360Sources);

    // Act
    const offenders = findForbiddenRoleSources(files);

    // Assert
    expect(
      offenders,
      `Forbidden role source referenced by: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("roleSource guard — useMyContexts is read only from useViewerRole.ts", () => {
  it("is the sole entity360/ file importing useMyContexts", () => {
    // Arrange
    const referencing = nonTestEntity360Sources
      .filter(([, content]) => /\buseMyContexts\b/.test(content))
      .map(([path]) => path);

    // Assert
    expect(
      referencing.every((path) => path.endsWith("/useViewerRole.ts")),
    ).toBe(true);
    // Sanity: the allowlisted file really is in the scanned set (companion
    // to the "scanned something" precondition above).
    expect(referencing.some((path) => path.endsWith("/useViewerRole.ts"))).toBe(
      true,
    );
  });
});

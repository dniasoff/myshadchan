import { describe, expect, it } from "vitest";

/**
 * AC 4 / AC 5 / AC 6 guards (Epic 3 API contract §2 rule 3, §4 rules 1 and 4,
 * §13 rule 2). Every predicate below is a pure function shown red against a
 * deliberately broken fixture before it is shown green against the real
 * `entity360/**` sources — the same pattern as
 * `entity360Style.guard.test.ts` and
 * `references/entitlementGate.guard.test.ts`. A guard that cannot fail is
 * not coverage.
 */

const sources = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Test/guard files legitimately quote the banned patterns in prose or in
// deliberately-broken fixtures (this file is itself one of them) — excluded
// from the "real source" sweep, exactly as entitlementGate.guard.test.ts does.
const isTestOrGuardFile = (path: string): boolean =>
  path.includes(".test.") || path.includes(".guard.");

const REGISTER_CALL_RE = /registerEntityDescriptor\s*\(/;
const MEMBER_ROLE_LITERAL_RE = /"parent_admin"/;
// A local re-declaration of TabKey, e.g. `type TabKey = "overview" | ...`.
// `export type TabKey = (typeof TAB_KEYS)[number];` in tabKeys.ts itself is
// the one sanctioned definition and is excluded by path, not by this regex.
const LOCAL_TAB_KEY_TYPE_RE = /\btype\s+TabKey\s*=/;
// `export type EntityRelationshipDescriptor = ...` outside its one owning
// module (relationshipDescriptor.ts, excluded by path).
const RELATIONSHIP_DESCRIPTOR_TYPE_RE =
  /export\s+type\s+EntityRelationshipDescriptor\s*=/;

/** AC 4: the doc comment at the top of entityDescriptor.ts must name both `EntityList` and the "never redefine" rule. */
function hasEntityListDocComment(source: string): boolean {
  return source.includes("EntityList") && source.includes("never redefine");
}

/** AC 4: entityDescriptor.ts / registry.ts must register no descriptor themselves. */
function callsRegisterEntityDescriptor(source: string): boolean {
  return REGISTER_CALL_RE.test(source);
}

/** AC 5: no file under entity360/ may hardcode the MemberRole literal "parent_admin". */
function declaresMemberRoleLiteral(source: string): boolean {
  return MEMBER_ROLE_LITERAL_RE.test(source);
}

/** AC 5: no file under entity360/ (other than tabKeys.ts) may re-declare TabKey. */
function declaresLocalTabKeyType(source: string): boolean {
  return LOCAL_TAB_KEY_TYPE_RE.test(source);
}

/** AC 6: no file under entity360/ (other than relationshipDescriptor.ts) may re-declare EntityRelationshipDescriptor. */
function declaresRelationshipDescriptorType(source: string): boolean {
  return RELATIONSHIP_DESCRIPTOR_TYPE_RE.test(source);
}

describe("hasEntityListDocComment — shown red then green", () => {
  it("is false for a doc comment naming neither EntityList nor the never-redefine rule", () => {
    // Arrange
    const fixture = `/** Some other module. */\nexport type X = { a: string };`;

    // Act / Assert
    expect(hasEntityListDocComment(fixture)).toBe(false);
  });

  it("is true for the real entityDescriptor.ts source", () => {
    expect(hasEntityListDocComment(sources["./entityDescriptor.ts"])).toBe(
      true,
    );
  });
});

describe("callsRegisterEntityDescriptor — shown red then green", () => {
  it("is true for a fixture that self-registers at module scope", () => {
    // Arrange
    const fixture = `registerEntityDescriptor({ name: "x", buildRecordPath: (id) => \`/x/\${id}\`, label: "X" });`;

    // Act / Assert
    expect(callsRegisterEntityDescriptor(fixture)).toBe(true);
  });

  it("is false for the real entityDescriptor.ts and registry.ts sources", () => {
    expect(
      callsRegisterEntityDescriptor(sources["./entityDescriptor.ts"]),
    ).toBe(false);
    expect(callsRegisterEntityDescriptor(sources["./registry.ts"])).toBe(false);
  });
});

describe("declaresMemberRoleLiteral — shown red then green", () => {
  it("is true for a fixture hardcoding the parent_admin literal", () => {
    // Arrange
    const fixture = `if (role === "parent_admin") { /* ... */ }`;

    // Act / Assert
    expect(declaresMemberRoleLiteral(fixture)).toBe(true);
  });

  it("is false across every real (non-test) source file under entity360/", () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTestOrGuardFile(path)) continue;
      expect(declaresMemberRoleLiteral(source), path).toBe(false);
    }
  });
});

describe("declaresLocalTabKeyType — shown red then green", () => {
  it("is true for a fixture re-declaring TabKey as a local union", () => {
    // Arrange
    const fixture = `type TabKey = "overview" | "notes";`;

    // Act / Assert
    expect(declaresLocalTabKeyType(fixture)).toBe(true);
  });

  it("is false across every real (non-test) source file under entity360/, other than tabKeys.ts's own definition", () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTestOrGuardFile(path) || path === "./tabKeys.ts") continue;
      expect(declaresLocalTabKeyType(source), path).toBe(false);
    }
  });
});

describe("declaresRelationshipDescriptorType — shown red then green", () => {
  it("is true for a fixture re-declaring EntityRelationshipDescriptor", () => {
    // Arrange
    const fixture = `export type EntityRelationshipDescriptor = { key: string };`;

    // Act / Assert
    expect(declaresRelationshipDescriptorType(fixture)).toBe(true);
  });

  it("is false across every real (non-test) source file under entity360/, other than relationshipDescriptor.ts's own definition", () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTestOrGuardFile(path) || path === "./relationshipDescriptor.ts")
        continue;
      expect(declaresRelationshipDescriptorType(source), path).toBe(false);
    }
  });
});

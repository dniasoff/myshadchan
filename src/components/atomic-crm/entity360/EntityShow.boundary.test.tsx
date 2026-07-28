import { describe, expect, it } from "vitest";

import entityShowSource from "./EntityShow.tsx?raw";

/**
 * Story 3.3b AC 9's `?raw` boundary guard, scoped to `EntityShow.tsx` alone
 * (contract §4 rule 5 / §12 build-order step 5): no import from any sibling
 * directory of `entity360/`, and no entity-name string literal.
 *
 * **Two import idioms, both forbidden, both must be caught.** The repo's
 * dominant import style inside `atomic-crm/` is the `@/components/...`
 * alias, not a relative `../` — `Entity360Tabs.tsx` itself imports
 * `@/components/ui/tabs`. A guard that only matches `from "../"` misses the
 * likelier escape route entirely: `import { SingleAvatar } from
 * "@/components/atomic-crm/singles/SingleAvatar";` is exactly as much a
 * sibling-directory import as `from "../singles/SingleAvatar"`, and the
 * contract's own wording ("no import from any sibling directory of
 * `entity360/`") does not carve out the alias form. (Adversarial review,
 * Epic 3 step 5, finding 1 — the relative-only regex was proven to let this
 * fixture through green.)
 */

const RELATIVE_ESCAPING_IMPORT_RE = /from\s+["']\.\.\//;
const ATOMIC_CRM_ALIAS_ESCAPING_IMPORT_RE =
  /from\s+["']@\/components\/atomic-crm\/(?!entity360\/)[^"']+["']/;

const ENTITY_NAMES = [
  "shidduchim",
  "singles",
  "inbox_items",
  "shadchanim",
  "references",
  "tasks",
  "members",
  "connections",
];

function importsEscapeEntity360(source: string): boolean {
  return (
    RELATIVE_ESCAPING_IMPORT_RE.test(source) ||
    ATOMIC_CRM_ALIAS_ESCAPING_IMPORT_RE.test(source)
  );
}

function containsEntityNameLiteral(source: string): boolean {
  return ENTITY_NAMES.some((name) =>
    new RegExp(`["'\`]${name}["'\`]`).test(source),
  );
}

describe("importsEscapeEntity360 — relative import idiom", () => {
  it("is true for a fixture importing from a sibling directory via a relative path", () => {
    // Arrange — a plausible but forbidden import; note it names no
    // four-way alternation, matching ANY sibling directory (contract §4,
    // "not a four-name alternation, because connections/ arrives in 8.5").
    const fixture = `import { Whatever } from "../some-other-entity/Whatever";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(true);
  });

  it("is false for a relative import that stays inside entity360/", () => {
    // Arrange
    const fixture = `import { Entity360 } from "./Entity360";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(false);
  });
});

describe("importsEscapeEntity360 — @/ alias import idiom", () => {
  it("is true for a fixture importing from a sibling directory via the @/components/atomic-crm alias", () => {
    // Arrange — the exact fixture the review used to prove the
    // relative-only regex was not falsifiable against this idiom.
    const fixture = `import { SingleAvatar } from "@/components/atomic-crm/singles/SingleAvatar";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(true);
  });

  it("is false for an alias import that stays inside entity360/ (including its own subdirectories)", () => {
    // Arrange
    const fixture = `import { RelatedRecordsTab } from "@/components/atomic-crm/entity360/tabs/RelatedRecordsTab";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(false);
  });

  it("is false for an alias import outside atomic-crm/ entirely (admin/ui/lib are not entity360's siblings)", () => {
    // Arrange — `src/components/admin/` and `src/components/ui/` are
    // siblings of `atomic-crm/`, not of `entity360/`; the boundary this
    // guard enforces is narrower.
    const fixture = `import { Tabs } from "@/components/ui/tabs";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(false);
  });

  it("is false for the real EntityShow.tsx source", () => {
    expect(importsEscapeEntity360(entityShowSource)).toBe(false);
  });
});

describe("containsEntityNameLiteral", () => {
  it("is true for a fixture hardcoding a resource name", () => {
    // Arrange
    const fixture = `if (resource === "shidduchim") { /* ... */ }`;

    // Act / Assert
    expect(containsEntityNameLiteral(fixture)).toBe(true);
  });

  it("is false for the real EntityShow.tsx source", () => {
    expect(containsEntityNameLiteral(entityShowSource)).toBe(false);
  });
});

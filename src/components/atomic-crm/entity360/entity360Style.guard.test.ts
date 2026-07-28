import { describe, expect, it } from "vitest";

import entity360Source from "./Entity360.tsx?raw";
import entityAvatarSource from "./EntityAvatar.tsx?raw";

/**
 * AC 4 / AC 7 guard (Epic 3 API contract §1 rule 6, §7, §13 rule 2): the
 * previous revision of this story banned inline `style` background on both
 * files while simultaneously requiring `EntityAvatar`'s `--avatar-{n}`
 * background "exactly as today" — impossible, since Tailwind cannot express
 * a dynamic `--avatar-{0..9}` index without a safelist. The ban below is
 * scoped to layout properties; `EntityAvatar`'s `backgroundColor`/`color`
 * are the carve-out. This predicate is shown red (the four fixtures below)
 * and green (the two real sources) in the same run, permanently.
 */

const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
const ARBITRARY_PIXEL_WIDTH_RE = /\b(?:min-w|w|basis)-\[(\d+)px\]/g;
const STYLE_OBJECT_RE = /style=\{\{([\s\S]*?)\}\}/g;
const LAYOUT_STYLE_KEY_RE =
  /\b(width|height|min\w*|max\w*|margin\w*|padding\w*|position|top|right|bottom|left|display|flex\w*|grid\w*|gap\w*|inset\w*)\s*:/g;
const ENTITY360_ALLOWED_IMPORTS = new Set(["react", "@/lib/utils"]);
const IMPORT_SPECIFIER_RE = /from\s+["']([^"']+)["']/g;

/**
 * Pure predicate, declared in-file per the repo's `findManifestViolations`
 * pattern [Source: root/routeManifest.test.ts]. `fileName` selects which
 * file-specific rules apply: only a file named `EntityAvatar.*` may contain
 * a `style=` attribute at all, and only that has its style-object property
 * keys checked against the layout-property denylist; only a file named
 * `Entity360.*` (and not `EntityAvatar.*`) is checked against the import
 * allowlist (AC 7). The colour-literal and arbitrary-pixel-width checks
 * apply to any file.
 */
function findStyleViolations(fileName: string, source: string): string[] {
  const violations: string[] = [];
  const isEntityAvatar = fileName.includes("EntityAvatar");
  const isEntity360 = fileName.includes("Entity360") && !isEntityAvatar;

  if (COLOR_LITERAL_RE.test(source)) {
    violations.push(`${fileName}: hard-coded colour literal`);
  }

  for (const match of source.matchAll(ARBITRARY_PIXEL_WIDTH_RE)) {
    if (Number(match[1]) > 375) {
      violations.push(
        `${fileName}: arbitrary pixel width "${match[0]}" exceeds 375px`,
      );
    }
  }

  if (isEntity360 && /\bstyle\s*=/.test(source)) {
    violations.push(`${fileName}: contains a style attribute`);
  }

  if (isEntityAvatar) {
    for (const styleMatch of source.matchAll(STYLE_OBJECT_RE)) {
      const body = styleMatch[1];
      for (const keyMatch of body.matchAll(LAYOUT_STYLE_KEY_RE)) {
        violations.push(
          `${fileName}: style object assigns layout property "${keyMatch[1]}"`,
        );
      }
    }
  }

  if (isEntity360) {
    for (const importMatch of source.matchAll(IMPORT_SPECIFIER_RE)) {
      const specifier = importMatch[1];
      if (!ENTITY360_ALLOWED_IMPORTS.has(specifier)) {
        violations.push(`${fileName}: disallowed import "${specifier}"`);
      }
    }
  }

  return violations;
}

describe("findStyleViolations", () => {
  it("reports no violations for the real Entity360.tsx source", () => {
    expect(findStyleViolations("Entity360.tsx", entity360Source)).toEqual([]);
  });

  it("reports no violations for the real EntityAvatar.tsx source", () => {
    expect(findStyleViolations("EntityAvatar.tsx", entityAvatarSource)).toEqual(
      [],
    );
  });

  it("flags a hex colour literal", () => {
    // Arrange
    const fixture = `export const X = "#ffffff";`;

    // Act
    const violations = findStyleViolations("Fixture.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags an oklch( colour literal", () => {
    // Arrange
    const fixture = `const y = "oklch(0.5 0.1 200)";`;

    // Act
    const violations = findStyleViolations("Fixture.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags an arbitrary pixel width above 375, numerically (not by digit count)", () => {
    // Arrange — a previous revision's regex matched three-digit values only,
    // so a four-digit value like 1024 passed clean. Assert it does not here.
    const fixture = `<div className="min-w-[1024px]" />`;

    // Act
    const violations = findStyleViolations("Fixture.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("does not flag an arbitrary pixel width at or below 375", () => {
    // Arrange
    const fixture = `<div className="min-w-[375px]" />`;

    // Act
    const violations = findStyleViolations("Fixture.tsx", fixture);

    // Assert
    expect(violations).toEqual([]);
  });

  it("flags an EntityAvatar style object assigning a layout property (minWidth)", () => {
    // Arrange
    const fixture = `
      <div
        style={{
          backgroundColor: "var(--avatar-0)",
          minWidth: 40,
        }}
      />
    `;

    // Act
    const violations = findStyleViolations("EntityAvatar.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("does not flag EntityAvatar's own backgroundColor/color style assignment", () => {
    // Arrange
    const fixture = `
      <div
        style={{
          backgroundColor: "var(--avatar-0)",
          color: "var(--avatar-ink)",
        }}
      />
    `;

    // Act
    const violations = findStyleViolations("EntityAvatar.tsx", fixture);

    // Assert
    expect(violations).toEqual([]);
  });

  it("flags any style= attribute in Entity360.tsx", () => {
    // Arrange
    const fixture = `<div style={{ color: "red" }} />`;

    // Act
    const violations = findStyleViolations("Entity360.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags an Entity360.tsx import outside the react / @/lib/utils allowlist", () => {
    // Arrange — AC 7's fixture: a bespoke primitive Entity360 must not own.
    const fixture = `import { Card } from "@/components/ui/card";`;

    // Act
    const violations = findStyleViolations("Entity360.tsx", fixture);

    // Assert
    expect(violations.length).toBeGreaterThan(0);
  });

  it("does not flag Entity360.tsx's own allowlisted imports", () => {
    // Arrange
    const fixture = `import type { ReactNode } from "react";\nimport { cn } from "@/lib/utils";`;

    // Act
    const violations = findStyleViolations("Entity360.tsx", fixture);

    // Assert
    expect(violations).toEqual([]);
  });
});

describe("Entity360 statBand/alertSlot JSDoc (AC 7)", () => {
  it("names DashboardStat in the statBand prop's JSDoc", () => {
    expect(entity360Source).toMatch(/DashboardStat[\s\S]*?statBand\?:/);
  });

  it("names Alert in the alertSlot prop's JSDoc", () => {
    expect(entity360Source).toMatch(/Alert[\s\S]*?alertSlot\?:/);
  });
});

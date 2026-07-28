import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";

// These assertions are about real, computed flexbox geometry (overflow,
// bounding rects) — meaningless without the real Tailwind-generated
// stylesheet actually applying to the rendered classes.
import "@/index.css";

import { Entity360 } from "./Entity360";

/** No whitespace at all — the only way a browser can avoid overflow with
 * this string is by breaking within it (AC 3 / UX-DR11). */
const unbroken = (label: string) => `${label}${"x".repeat(600)}`;

/** The viewport every other suite in this file expects going in — restored
 * in `afterEach` so no test here depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

describe("Entity360 responsive layout", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("keeps the shell root free of horizontal overflow at 375px with long unbroken content in every region", async () => {
    // Arrange
    await page.viewport(375, 720);

    // Act
    const screen = await render(
      <Entity360
        breadcrumb={<span>{unbroken("breadcrumb")}</span>}
        identityHeader={<span>{unbroken("identity")}</span>}
        statBand={<span>{unbroken("stat")}</span>}
        alertSlot={<span>{unbroken("alert")}</span>}
        tabBar={<span>{unbroken("tabs")}</span>}
        rightRail={<span>{unbroken("rail")}</span>}
      >
        <span>{unbroken("content")}</span>
      </Entity360>,
    );
    const root = screen.container.children[0] as HTMLElement;

    // Assert — no horizontal scrollbar would be needed to see all content.
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  });

  it("stacks the right rail below the content column at 375px", async () => {
    // Arrange
    await page.viewport(375, 720);

    // Act
    const screen = await render(
      <Entity360 rightRail={<div data-role="rail">RAIL</div>}>
        <div data-role="content">CONTENT</div>
      </Entity360>,
    );
    const content = screen.container.querySelector(
      '[data-role="content"]',
    ) as HTMLElement;
    const rail = screen.container.querySelector(
      '[data-role="rail"]',
    ) as HTMLElement;

    // Assert
    expect(rail.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().bottom,
    );
  });

  it("places the right rail beside the content column at 1280px", async () => {
    // Arrange
    await page.viewport(1280, 720);

    // Act
    const screen = await render(
      <Entity360 rightRail={<div data-role="rail">RAIL</div>}>
        <div data-role="content">CONTENT</div>
      </Entity360>,
    );
    const content = screen.container.querySelector(
      '[data-role="content"]',
    ) as HTMLElement;
    const rail = screen.container.querySelector(
      '[data-role="rail"]',
    ) as HTMLElement;

    // Assert
    expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().right,
    );
  });
});

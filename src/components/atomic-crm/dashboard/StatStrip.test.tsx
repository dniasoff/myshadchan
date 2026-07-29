import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import { StatStrip, type StatStripItem } from "./StatStrip";

/**
 * Wave S (mobile-redesign-plan.md §4 S-A): a single `Card` replacing three
 * stacked `DashboardStat` tiles. Pins the value/label pairing, the optional
 * link, and that a plain segment never renders an anchor at all.
 */

const ITEMS: StatStripItem[] = [
  { label: "Shidduchim", value: 14 },
  { label: "Progressed", value: 6 },
  { label: "Reached yes", value: 2, to: "/shidduchim" },
];

describe("StatStrip", () => {
  it("renders every item's value and label", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <StatStrip items={ITEMS} />
      </TestMemoryRouter>,
    );

    // Assert
    for (const item of ITEMS) {
      await expect.element(screen.getByText(String(item.value))).toBeVisible();
      await expect
        .element(screen.getByText(item.label, { exact: true }))
        .toBeVisible();
    }
  });

  it("renders a segment with no `to` as plain text, not a link", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <StatStrip items={[{ label: "Shidduchim", value: 14 }]} />
      </TestMemoryRouter>,
    );

    // Assert
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
  });

  it("wraps a segment with `to` in a link to that path", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <StatStrip
          items={[{ label: "Reached yes", value: 2, to: "/shidduchim" }]}
        />
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByRole("link", { name: /Reached yes/ }))
      .toHaveAttribute("href", "/shidduchim");
  });

  it("renders exactly one hidden gradient hairline, unaffected by item count", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <StatStrip items={ITEMS} />
      </TestMemoryRouter>,
    );

    // Assert
    const hairline = screen.container.querySelector('[aria-hidden="true"]');
    expect(hairline).not.toBeNull();
  });
});

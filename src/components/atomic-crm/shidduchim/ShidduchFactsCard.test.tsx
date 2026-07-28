import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { ShidduchSummary } from "../types";
import { ShidduchFactsCard } from "./ShidduchFactsCard";

/**
 * Story 3-10 AC 8: `ShidduchFactsCard` now renders through the shared
 * `OverviewFactGrid` instead of a local `FactRow` — these two tests prove
 * the extraction is behaviour-preserving.
 */

const makeShidduch = (
  overrides: Partial<ShidduchSummary> & Pick<ShidduchSummary, "id">,
): ShidduchSummary =>
  ({
    account_id: 1,
    single_id: 1,
    pipeline_state: "new",
    redt_date: "2026-07-01",
    first_suggested_at: "2026-07-01T00:00:00.000Z",
    origin: "manual",
    visibility: "shared",
    index: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }) as ShidduchSummary;

describe("ShidduchFactsCard", () => {
  it("renders the heading and all six fact labels for a fully-populated shidduch", async () => {
    // Arrange
    const shidduch = makeShidduch({
      id: 1,
      parents_en: "Mr & Mrs Cohen",
      seminary_en: "Bais Yaakov",
      shul_en: "Young Israel",
      location_en: "Lakewood",
      age: 24,
      height: "5'6\"",
    });

    // Act
    const screen = await render(<ShidduchFactsCard shidduch={shidduch} />);

    // Assert — AD-23 heading fix (AC 8's one deliberate text change)
    await expect
      .element(screen.getByText("Shidduch facts"))
      .toBeInTheDocument();
    for (const label of [
      "Parents",
      "Seminary",
      "Shul",
      "Location",
      "Age",
      "Height",
    ]) {
      await expect.element(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders the empty-state string when the shidduch has no facts on file", async () => {
    // Arrange
    const shidduch = makeShidduch({ id: 2 });

    // Act
    const screen = await render(<ShidduchFactsCard shidduch={shidduch} />);

    // Assert
    await expect
      .element(screen.getByText("No details on file yet."))
      .toBeInTheDocument();
  });
});

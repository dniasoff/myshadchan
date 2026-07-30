import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { ShidduchSummary } from "../types";
import { ShidduchFactsCard } from "./ShidduchFactsCard";
import { computeAgeFromDob } from "./shidduchAge";

/**
 * Story 3-10 AC 8: `ShidduchFactsCard` now renders through the shared
 * `OverviewFactGrid` instead of a local `FactRow` — these two tests prove
 * the extraction is behaviour-preserving.
 *
 * Story 5.2 AC-1/AC-2: father/mother replace the single "Parents" fact, and
 * DOB, background, marital status and the existing-children note are added.
 * AC-2's null-omission guarantee is `OverviewFactGrid`'s own — reused, not
 * re-tested here beyond the empty-state case.
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
  it("renders the heading and every fact label for a fully-populated shidduch (AC-1)", async () => {
    // Arrange
    const referenceDate = new Date();
    const dob = "1998-05-02";
    const shidduch = makeShidduch({
      id: 1,
      father_en: "Yaakov Cohen",
      mother_en: "Rivka Cohen",
      seminary_en: "Bais Yaakov",
      shul_en: "Young Israel",
      location_en: "Lakewood",
      age: 24,
      height: "5'6\"",
      dob,
      background: "Grew up in Lakewood, learns full-time",
      marital_status: "Single",
      existing_children_note: "None",
    });

    // Act
    const screen = await render(<ShidduchFactsCard shidduch={shidduch} />);

    // Assert — AD-23 heading fix (AC 8's one deliberate text change)
    await expect
      .element(screen.getByText("Shidduch facts"))
      .toBeInTheDocument();
    for (const label of [
      "Father",
      "Mother",
      "Seminary",
      "Shul",
      "Location",
      "Age",
      "Date of birth",
      "Height",
      "Background",
      "Marital status",
      "Existing children",
    ]) {
      await expect.element(screen.getByText(label)).toBeInTheDocument();
    }
    // Values — the raw DOB string, and the live age computed from it (which
    // takes priority over the stored `age: 24` once a DOB is on file).
    await expect.element(screen.getByText(dob)).toBeInTheDocument();
    await expect
      .element(screen.getByText(String(computeAgeFromDob(dob, referenceDate))))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Yaakov Cohen")).toBeInTheDocument();
    await expect.element(screen.getByText("Rivka Cohen")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Grew up in Lakewood, learns full-time"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Single")).toBeInTheDocument();
    await expect.element(screen.getByText("None")).toBeInTheDocument();
  });

  it("falls back to the stored age when no DOB is on file", async () => {
    // Arrange
    const shidduch = makeShidduch({ id: 4, age: 24 });

    // Act
    const screen = await render(<ShidduchFactsCard shidduch={shidduch} />);

    // Assert
    await expect.element(screen.getByText("24")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Date of birth"))
      .not.toBeInTheDocument();
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

  it("omits every new fact's label when only name_en is set (AC-2)", async () => {
    // Arrange — name is rendered by ShidduchShowHeader, never by this card;
    // this fixture proves that populating it does not leak a fact row here.
    const shidduch = makeShidduch({ id: 3, name_en: "Chaya Cohen" });

    // Act
    const screen = await render(<ShidduchFactsCard shidduch={shidduch} />);

    // Assert
    await expect
      .element(screen.getByText("No details on file yet."))
      .toBeInTheDocument();
    for (const label of [
      "Father",
      "Mother",
      "Date of birth",
      "Background",
      "Marital status",
      "Existing children",
    ]) {
      await expect.element(screen.getByText(label)).not.toBeInTheDocument();
    }
  });
});

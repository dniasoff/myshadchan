import { render } from "vitest-browser-react";
import type { Identifier } from "ra-core";

import type { ShidduchCatchSuggestion, ShidduchDatePrior } from "../types";
import { ShidduchCatchPanel } from "./ShidduchCatchPanel";

/**
 * These tests pin the invariants of the E3 catch review surface: the user is
 * shown WHY two suggestions look like the same person (never just a score), and
 * nothing merges without a click.
 */

const suggestion = (
  overrides: Partial<ShidduchCatchSuggestion> = {},
): ShidduchCatchSuggestion => ({
  prior_shidduchim_id: 42,
  confidence: 0.85,
  deciding_facts: [
    {
      signal: "name",
      detail: "name matches as a Hebrew/English spelling variant",
    },
    { signal: "school", detail: "same school or seminary" },
  ],
  name_en: "Chaim Cohen",
  name_he: null,
  age: 24,
  pipeline_state: "look_into",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-01",
  child_id: 7,
  child_first_name_en: "Rivka",
  child_first_name_he: null,
  shadchan_name: "Mrs Klein",
  ...overrides,
});

const priorDate = (
  overrides: Partial<ShidduchDatePrior> = {},
): ShidduchDatePrior => ({
  date_record_id: 5,
  person_name_en: "Chaim Cohen",
  person_name_he: null,
  date_on: "2026-01-10",
  outcome: "no_second_date",
  child_id: 7,
  child_first_name_en: "Leah",
  ...overrides,
});

const renderPanel = async (props: {
  suggestions?: ShidduchCatchSuggestion[];
  dates?: ShidduchDatePrior[];
  onConfirm?: (s: ShidduchCatchSuggestion) => void;
  onDismiss?: (id: Identifier) => void;
}) =>
  render(
    <ShidduchCatchPanel
      suggestions={props.suggestions ?? []}
      dates={props.dates ?? []}
      onConfirm={props.onConfirm ?? (() => {})}
      onDismiss={props.onDismiss ?? (() => {})}
    />,
  );

describe("ShidduchCatchPanel", () => {
  it("renders nothing when there is no catch", async () => {
    // Arrange / Act
    const screen = await renderPanel({ suggestions: [], dates: [] });

    // Assert
    await expect
      .element(screen.getByText(/You've come across this person before/i))
      .not.toBeInTheDocument();
  });

  it("shows the deciding facts rather than only a score", async () => {
    // Arrange / Act
    const screen = await renderPanel({ suggestions: [suggestion()] });

    // Assert
    await expect
      .element(screen.getByText(/Hebrew\/English spelling variant/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/same school or seminary/i))
      .toBeInTheDocument();
  });

  it("shows the prior context — for whom, via whom", async () => {
    // Arrange / Act
    const screen = await renderPanel({ suggestions: [suggestion()] });

    // Assert
    await expect
      .element(screen.getByText(/suggested for Rivka/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/via Mrs Klein/i))
      .toBeInTheDocument();
  });

  it("offers exactly two choices and takes neither on its own", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    // Act
    const screen = await renderPanel({
      suggestions: [suggestion()],
      onConfirm,
      onDismiss,
    });
    await expect
      .element(screen.getByRole("button", { name: /Confirm match/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /different person/i }))
      .toBeInTheDocument();

    // Assert — rendering alone must never confirm or dismiss anything.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("confirms only when the user clicks confirm", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const match = suggestion();
    const screen = await renderPanel({ suggestions: [match], onConfirm });

    // Act
    await screen.getByRole("button", { name: /Confirm match/i }).click();

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(match);
  });

  it("dismisses the prior suggestion when the user says it is somebody else", async () => {
    // Arrange
    const onDismiss = vi.fn();
    const screen = await renderPanel({
      suggestions: [suggestion({ prior_shidduchim_id: 99 })],
      onDismiss,
    });

    // Act
    await screen.getByRole("button", { name: /different person/i }).click();

    // Assert
    expect(onDismiss).toHaveBeenCalledWith(99);
  });

  it("shows an honestly-corroborated prior date as read-only context", async () => {
    // Arrange / Act
    const screen = await renderPanel({ suggestions: [], dates: [priorDate()] });

    // Assert
    await expect
      .element(screen.getByText(/Previously dated/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/no second date/i))
      .toBeInTheDocument();
  });
});

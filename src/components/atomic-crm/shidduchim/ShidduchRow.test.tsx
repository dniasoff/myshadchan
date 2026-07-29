import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot.
import "./entityDescriptor";
import { buildRecordPath } from "../entity360/entityPaths";
import type { ShidduchSummary } from "../types";
import { ShidduchRow } from "./ShidduchRow";

const buildShidduch = (
  overrides: Partial<ShidduchSummary> = {},
): ShidduchSummary => ({
  id: 42,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
  ...overrides,
});

const renderRow = async (
  overrides: Partial<ShidduchSummary> = {},
  onMove = vi.fn(),
) => {
  const screen = await render(
    <TestMemoryRouter initialEntries={["/shidduchim"]}>
      <ShidduchRow shidduch={buildShidduch(overrides)} onMove={onMove} />
    </TestMemoryRouter>,
  );
  return { screen, onMove };
};

describe("ShidduchRow — RecordLink mention, Move as a sibling (AC-12)", () => {
  it("wraps the record mention in an anchor at buildRecordPath('shidduchim', id)", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", buildRecordPath("shidduchim", 42));
  });

  it("renders the Move button as a sibling of the anchor, never nested inside it", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert
    const link = screen.getByRole("link").element();
    const moveButton = screen.getByRole("button", { name: /Move/ }).element();
    expect(link.contains(moveButton)).toBe(false);
    expect(moveButton.contains(link)).toBe(false);
  });

  it("calls onMove when the Move button is tapped, without navigating", async () => {
    // Arrange
    let pathname: string | undefined;
    const onMove = vi.fn();
    const screen = await render(
      <TestMemoryRouter
        initialEntries={["/shidduchim"]}
        locationCallback={(location) => (pathname = location.pathname)}
      >
        <ShidduchRow shidduch={buildShidduch()} onMove={onMove} />
      </TestMemoryRouter>,
    );

    // Act
    await screen.getByRole("button", { name: /Move/ }).click();

    // Assert
    expect(onMove).toHaveBeenCalledOnce();
    expect(pathname).toBe("/shidduchim");
  });

  it("renders no state chip — the section is the state", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert — no StateChip text ("New") anywhere on the row.
    await expect.element(screen.getByText("New")).not.toBeInTheDocument();
  });

  it("shows a catch chip when catch_count is greater than zero", async () => {
    // Arrange / Act
    const { screen } = await renderRow({ catch_count: 2 });

    // Assert
    await expect
      .element(screen.getByText("Suggested before"))
      .toBeInTheDocument();
  });

  it("shows no catch chip when catch_count is zero", async () => {
    // Arrange / Act
    const { screen } = await renderRow({ catch_count: 0 });

    // Assert
    await expect
      .element(screen.getByText("Suggested before"))
      .not.toBeInTheDocument();
  });
});

import type { DraggableStateSnapshot } from "@hello-pangea/dnd";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot.
import "./entityDescriptor";
import type { ShidduchSummary } from "../types";
import { ShidduchCardContent } from "./ShidduchCard";

/**
 * Pins AC 4: the board card's accessibility defect (no `href`, announced as
 * a button, no keyboard activation path) is fixed by wrapping the `<Card>`
 * in a `RecordLink`, while drag-ending clicks still do not navigate.
 */

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

const renderCard = async (snapshot?: Partial<DraggableStateSnapshot>) => {
  let pathname: string | undefined;
  const screen = await render(
    <TestMemoryRouter
      initialEntries={["/shidduchim"]}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <ShidduchCardContent
        shidduch={buildShidduch()}
        snapshot={snapshot as DraggableStateSnapshot | undefined}
      />
    </TestMemoryRouter>,
  );
  return { screen, getPathname: () => pathname };
};

describe("ShidduchCardContent — AC 4 accessibility fix", () => {
  it("renders a real link, with an href to the record's show route", async () => {
    // Arrange / Act
    const { screen } = await renderCard();

    // Assert — Story 5.1 flipped shidduchim's buildRecordPath to the bare
    // AD-24 shape (no more /show segment).
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/shidduchim/42");
  });

  it("navigates to the record on an ordinary click", async () => {
    // Arrange
    const { screen, getPathname } = await renderCard({ isDragging: false });

    // Act
    await screen.getByRole("link").click();

    // Assert
    await expect.poll(() => getPathname()).toBe("/shidduchim/42");
  });

  it("does not navigate when the click ends a drag", async () => {
    // Arrange
    const { screen, getPathname } = await renderCard({ isDragging: true });

    // Act
    await screen.getByRole("link").click();

    // Assert — onClickCapture's preventDefault suppressed the anchor's own
    // navigation; the location never changes.
    expect(getPathname()).toBe("/shidduchim");
  });
});

import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";
import type * as RaCore from "ra-core";

/**
 * Review fix (F5): the pre-story `ShadchanDirectory` gated its skeleton on
 * `shadchanimPending || shidduchimPending`; the retrofit dropped the second
 * half, so every card rendered immediately with `counts.get(id) ?? 0` and
 * flashed a wrong "0 suggestions" before the `shidduchim` count query
 * resolved. `useGetList` is mocked here (rather than driven through a real
 * FakeRest round trip) so the still-pending state is actually observable —
 * a real fake-data-provider request resolves before the first assertion
 * ever runs, which is exactly why this regression shipped with every test
 * green.
 */
const { useGetListMock } = vi.hoisted(() => ({ useGetListMock: vi.fn() }));

vi.mock("ra-core", async (importOriginal) => {
  const actual = await importOriginal<typeof RaCore>();
  return { ...actual, useGetList: useGetListMock };
});

// Side-effect import — registers the real `shadchanim` descriptor so
// `ShadchanCard`'s `RecordLink` resolves a real href instead of degrading to
// a plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanCardGrid } from "./ShadchanCardGrid";

const SHADCHANIM = [
  { id: 1, name: "Rivka Stern" },
  { id: 2, name: "Moshe Adler" },
];

const renderGrid = () =>
  render(
    <TestMemoryRouter>
      <ShadchanCardGrid data={SHADCHANIM} />
    </TestMemoryRouter>,
  );

describe("ShadchanCardGrid — gates on the shidduchim count query, not just the shadchanim list (F5)", () => {
  it("renders the skeleton, not a card claiming '0 suggestions', while the count query is pending", async () => {
    // Arrange
    useGetListMock.mockReturnValue({ data: undefined, isPending: true });

    // Act
    const screen = await renderGrid();

    // Assert — neither shadchan's card has rendered yet.
    await expect
      .element(screen.getByText("Rivka Stern"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Moshe Adler"))
      .not.toBeInTheDocument();
  });

  it("renders the real per-shadchan suggestion counts once the count query resolves", async () => {
    // Arrange — one suggestion for shadchan 1, none for shadchan 2.
    useGetListMock.mockReturnValue({
      data: [{ id: 100, shadchan_id: 1, pipeline_state: "new" }],
      isPending: false,
    });

    // Act
    const screen = await renderGrid();

    // Assert
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("Moshe Adler")).toBeInTheDocument();
    await expect.element(screen.getByText("1 suggestion")).toBeInTheDocument();
    await expect.element(screen.getByText("0 suggestions")).toBeInTheDocument();
  });
});

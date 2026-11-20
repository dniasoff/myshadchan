import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import { ShidduchTodoMarker } from "./ShidduchTodoMarker";
import {
  ShidduchTodoSummaryContext,
  ShidduchTodoSummaryStatusContext,
  type ShidduchTodoSummaryStatus,
  ShidduchTodoVisibilityContext,
} from "./ShidduchTodoSummaryContext";

type MarkerSummary = {
  count: number;
  earliestDueDate: string | null;
  hasOverdue: boolean;
  isDueSoon: boolean;
};

const summary: MarkerSummary = {
  count: 0,
  earliestDueDate: null,
  hasOverdue: false,
  isDueSoon: false,
};

const MarkerHarness = ({
  status = "ready",
  visible = true,
  markerSummary = summary,
}: {
  status?: ShidduchTodoSummaryStatus;
  visible?: boolean;
  markerSummary?: MarkerSummary;
}) => (
  <TestMemoryRouter>
    <ShidduchTodoVisibilityContext.Provider value={visible}>
      <ShidduchTodoSummaryStatusContext.Provider value={status}>
        <ShidduchTodoSummaryContext.Provider
          value={new Map([["42", markerSummary]])}
        >
          <ShidduchTodoMarker shidduchId={42} />
        </ShidduchTodoSummaryContext.Provider>
      </ShidduchTodoSummaryStatusContext.Provider>
    </ShidduchTodoVisibilityContext.Provider>
  </TestMemoryRouter>
);

const renderMarker = async (
  markerSummary: MarkerSummary,
  visible = true,
  status: ShidduchTodoSummaryStatus = "ready",
) =>
  render(
    <MarkerHarness
      status={status}
      visible={visible}
      markerSummary={markerSummary}
    />,
  );

describe("ShidduchTodoMarker", () => {
  it("renders overdue work with words and the destructive tone", async () => {
    const screen = await renderMarker({
      count: 2,
      earliestDueDate: "2026-11-10T09:00:00Z",
      hasOverdue: true,
      isDueSoon: false,
    });

    await expect.element(screen.getByText("Overdue to do")).toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Overdue to do"))
      .toHaveAttribute("aria-label", "Overdue to do");
  });

  it("renders due-soon work in amber words with its count and when", async () => {
    const screen = await renderMarker({
      count: 1,
      earliestDueDate: "2026-11-16T09:00:00Z",
      hasOverdue: false,
      isDueSoon: true,
    });

    await expect.element(screen.getByText(/1 to do ·/)).toBeInTheDocument();
    expect(screen.getByLabelText(/1 to do ·/).element().className).toContain(
      "amber",
    );
  });

  it("renders the explicit no-open state for rows without tasks", async () => {
    const screen = await renderMarker({
      count: 0,
      earliestDueDate: null,
      hasOverdue: false,
      isDueSoon: false,
    });

    await expect.element(screen.getByText("No open to do")).toBeInTheDocument();
  });

  it("hides when the list-level role gate denies visibility", async () => {
    const screen = await renderMarker(
      {
        count: 1,
        earliestDueDate: "2026-11-16T09:00:00Z",
        hasOverdue: false,
        isDueSoon: true,
      },
      false,
    );

    await expect
      .element(screen.getByLabelText(/to do/))
      .not.toBeInTheDocument();
  });

  it("keeps a stable slot while loading and when the summary resolves", async () => {
    const screen = await renderMarker(summary, true, "loading");
    const loadingSlot = screen.container.querySelector(
      '[data-slot="shidduch-todo-marker-slot"]',
    );

    expect(loadingSlot).not.toBeNull();
    expect(loadingSlot).toHaveClass("min-h-6");
    expect(loadingSlot).toHaveAttribute("aria-hidden", "true");
    await expect
      .element(screen.getByText("No open to do"))
      .not.toBeInTheDocument();

    await screen.rerender(
      <MarkerHarness
        status="ready"
        markerSummary={{
          count: 1,
          earliestDueDate: "2026-11-16T09:00:00Z",
          hasOverdue: false,
          isDueSoon: true,
        }}
      />,
    );

    const readySlot = screen.container.querySelector(
      '[data-slot="shidduch-todo-marker-slot"]',
    );
    expect(readySlot).toBe(loadingSlot);
    expect(readySlot).toHaveClass("min-h-6");
    expect(readySlot).not.toHaveAttribute("aria-hidden");
    await expect.element(screen.getByText(/1 to do ·/)).toBeInTheDocument();
  });

  it("reserves the slot and announces unavailable status on provider error", async () => {
    const screen = await renderMarker(summary, true, "error");
    const slot = screen.container.querySelector(
      '[data-slot="shidduch-todo-marker-slot"]',
    );

    expect(slot).not.toBeNull();
    expect(slot).toHaveClass("min-h-6");
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("To do status unavailable");
    await expect
      .element(screen.getByText("No open to do"))
      .not.toBeInTheDocument();
  });
});

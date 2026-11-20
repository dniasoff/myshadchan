import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import { ShidduchTodoMarker } from "./ShidduchTodoMarker";
import {
  ShidduchTodoSummaryContext,
  ShidduchTodoSummaryStatusContext,
  ShidduchTodoVisibilityContext,
} from "./ShidduchTodoSummaryContext";

const renderMarker = async (
  summary: {
    count: number;
    earliestDueDate: string | null;
    hasOverdue: boolean;
    isDueSoon: boolean;
  },
  visible = true,
) =>
  render(
    <TestMemoryRouter>
      <ShidduchTodoVisibilityContext.Provider value={visible}>
        <ShidduchTodoSummaryStatusContext.Provider value="ready">
          <ShidduchTodoSummaryContext.Provider
            value={new Map([["42", summary]])}
          >
            <ShidduchTodoMarker shidduchId={42} />
          </ShidduchTodoSummaryContext.Provider>
        </ShidduchTodoSummaryStatusContext.Provider>
      </ShidduchTodoVisibilityContext.Provider>
    </TestMemoryRouter>,
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
});

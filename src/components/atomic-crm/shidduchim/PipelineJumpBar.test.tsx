import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import type { PipelineState } from "../types";
import { PipelineJumpBar } from "./PipelineJumpBar";
import { PIPELINE_STATES } from "./pipelineStates";

const pipelineSectionId = (state: PipelineState): string =>
  `pipeline-section-${state}`;

/**
 * Review finding F1: `PipelineJumpBar` used to render `<a href="#…">` cells.
 * The app runs on ra-core's default HashRouter, so setting `location.hash`
 * IS a route change — every cell silently navigated the user off
 * `/shidduchim` instead of scrolling. This suite pins the fix (a `<button>`
 * that calls `scrollIntoView`, never touches `location`) and would have
 * failed against the original implementation: mounted under a real
 * `TestMemoryRouter`, a stray `href="#pipeline-section-…"` click changes
 * `location.pathname` from `/shidduchim` to `pipeline-section-…`.
 */
const buildCounts = (): Partial<Record<PipelineState, number>> =>
  Object.fromEntries(
    PIPELINE_STATES.map((state, index) => [state.value, index]),
  );

const renderJumpBarWithSections = async () => {
  let pathname: string | undefined;
  const screen = await render(
    <TestMemoryRouter
      initialEntries={["/shidduchim"]}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <PipelineJumpBar counts={buildCounts()} />
      {PIPELINE_STATES.map((state) => (
        <section
          key={state.value}
          id={pipelineSectionId(state.value)}
          aria-label={state.label}
        />
      ))}
    </TestMemoryRouter>,
  );
  return { screen, getPathname: () => pathname };
};

describe("PipelineJumpBar — table of contents, not navigation (F1 regression)", () => {
  it("renders no anchor elements — a HashRouter treats a bare '#id' href as a route change", async () => {
    // Arrange / Act
    const { screen } = await renderJumpBarWithSections();

    // Assert
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
  });

  /**
   * The label and its count are two adjacent `<span>`s, no literal space
   * between them in the markup — accessible-name computation may or may not
   * insert one (it does under real Playwright; `e2e/pipeline.spec.ts` hits
   * the same thing), so a plain `\b` after the label doesn't reliably bound
   * it. `\s*\d` matches either "New3" or "New 3" while still requiring a
   * digit, which is what disambiguates "No" from "Not-sure" (a real prefix
   * collision here) — the same intent as `ShidduchMoveSheet.test.tsx`'s own
   * `\b` comment, adapted for a label with no separating text node.
   */
  const jumpBarButton = (
    screen: Awaited<ReturnType<typeof renderJumpBarWithSections>>["screen"],
    label: string,
  ) => screen.getByRole("button", { name: new RegExp(`^${label}\\s*\\d`) });

  it("renders one button per PIPELINE_STATES entry, each carrying its label and count", async () => {
    // Arrange / Act
    const { screen } = await renderJumpBarWithSections();

    // Assert
    for (const [index, state] of PIPELINE_STATES.entries()) {
      await expect
        .element(jumpBarButton(screen, state.label))
        .toHaveTextContent(String(index));
    }
  });

  it("scrolls the matching section into view and does not change the route", async () => {
    // Arrange
    const { screen, getPathname } = await renderJumpBarWithSections();
    const target = document.getElementById(pipelineSectionId("look_into"));
    const scrollIntoView = vi.fn();
    if (target) target.scrollIntoView = scrollIntoView;

    // Act
    await jumpBarButton(screen, "Look-into").click();

    // Assert — proof this is a scroll, never a HashRouter navigation.
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(getPathname()).toBe("/shidduchim");
  });
});

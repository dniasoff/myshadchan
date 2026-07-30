import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";

import type { Reference } from "../types";
import { ReferenceHeader } from "./ReferenceHeader";

/**
 * Story 3.1 AC 5 rewire coverage: `ReferenceHeader` composes its avatar chip
 * from the shared `EntityAvatar` (Epic 3 API contract §1 rule 6). See
 * `SingleProfileHeader.test.tsx` for why this direct render matters.
 *
 * `ReferenceHeader` calls `useTranslate()` and `useReferenceLinks()`
 * (`useGetList`), so — unlike the other three headers — it needs a real
 * `ra-core` + data-provider context, not just its own props.
 */

const reference: Reference = {
  id: 1,
  account_id: 1,
  name_en: "Moshe Fried",
  created_at: "2026-01-01T00:00:00Z",
};

describe("ReferenceHeader", () => {
  it("renders the EntityAvatar chip with the AC 5 size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <StoryWrapper data={{ reference_links: [] }}>
        <ReferenceHeader reference={reference} />
      </StoryWrapper>,
    );
    const chip = screen.container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;

    // Assert
    for (const token of ["h-12", "w-12", "rounded-xl", "text-base"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("MF");
  });
});

/**
 * RULING 7 verification finding: `ReferenceHeader` destructured only
 * `{ links }` from `useReferenceLinks` and dropped `isPending`, so while the
 * `reference_links` query is in flight `summarizeCallProgress([])` reports
 * `0`/`0` — the meter briefly claimed "0 of 0 conversations done" on a
 * reference that has real conversations, the same false-empty state as the
 * `RepeatRecognitionPanel` finding lower on the same page, from the same
 * ignored `isPending`.
 */
describe("ReferenceHeader — isPending (RULING 7 false-empty finding)", () => {
  it('does not show "0 of 0 conversations done" while the links query is pending', async () => {
    // Arrange — the reference_links query never settles within the test.
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const screen = await render(
      <StoryWrapper data={{ reference_links: [] }} dataProvider={{ getList }}>
        <ReferenceHeader reference={reference} />
      </StoryWrapper>,
    );

    // Assert
    await expect
      .element(screen.getByText(/conversations done/))
      .not.toBeInTheDocument();
  });

  it("reserves the meter's footprint with a busy skeleton instead of the settled progress bar while pending", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const screen = await render(
      <StoryWrapper data={{ reference_links: [] }} dataProvider={{ getList }}>
        <ReferenceHeader reference={reference} />
      </StoryWrapper>,
    );

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.container.querySelector('[role="progressbar"]')).toBeNull();
  });
});

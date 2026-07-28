import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";

import type { Reference } from "../types";
import { ReferenceHeader } from "./ReferenceShow";

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

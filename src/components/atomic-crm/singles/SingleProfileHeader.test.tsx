import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { Single } from "../types";
import { SingleProfileHeader } from "./SingleShow";

/**
 * Story 3.1 AC 5 rewire coverage: `SingleProfileHeader` composes its avatar
 * chip from the shared `EntityAvatar` (Epic 3 API contract §1 rule 6). This
 * is the "no direct regression coverage" gap called out in the 3-1 review —
 * the per-variant `EntityAvatar` tests render the classNames directly, but
 * nothing rendered the real call site, so a wrong className at this call
 * site would have shipped silently.
 */

const single: Single = {
  id: 1,
  account_id: 1,
  first_name_en: "Ari",
  last_name_en: "Rosenberg",
  status: "paused", // avoids the active-status dot, itself aria-hidden
  created_at: "2026-01-01T00:00:00Z",
};

describe("SingleProfileHeader", () => {
  it("renders the EntityAvatar chip with the AC 5 size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(<SingleProfileHeader single={single} />);
    const chip = screen.container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;

    // Assert — the exact className this header passed before the rewire.
    for (const token of ["h-14", "w-14", "rounded-2xl", "text-xl"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("AR");
  });
});

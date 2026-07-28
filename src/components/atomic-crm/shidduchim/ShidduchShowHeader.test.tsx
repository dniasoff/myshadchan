import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Dialog } from "@/components/ui/dialog";

import type { ShidduchSummary } from "../types";
import { ShidduchShowHeader } from "./ShidduchShowHeader";

/**
 * Story 3.1 AC 5 rewire coverage: `ShidduchShowHeader` composes its avatar
 * chip from the shared `EntityAvatar` (Epic 3 API contract §1 rule 6). See
 * `SingleProfileHeader.test.tsx` for why this direct render matters.
 *
 * The header's own `ClockIcon` is also `aria-hidden`, but it is an `<svg>`
 * while `EntityAvatar` is a `<div>` — `div[aria-hidden="true"]` isolates the
 * avatar chip unambiguously.
 *
 * The header renders `<DialogTitle asChild>` around its name heading, so it
 * only mounts inside a real `Dialog` in production (`ShidduchShow.tsx`) — a
 * bare `<Dialog>` wrapper here supplies that context.
 */

const shidduch: ShidduchSummary = {
  id: 1,
  account_id: 1,
  single_id: 1,
  pipeline_state: "new",
  redt_date: "2026-07-01",
  first_suggested_at: "2026-07-01T00:00:00.000Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-07-01T00:00:00.000Z",
  name_en: "Shira Katz",
} as ShidduchSummary;

describe("ShidduchShowHeader", () => {
  it("renders the EntityAvatar chip with the AC 5 size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <Dialog open>
        <ShidduchShowHeader shidduch={shidduch} />
      </Dialog>,
    );
    const chip = screen.container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;

    // Assert
    for (const token of ["size-14", "rounded-2xl", "text-lg"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("SK");
  });
});

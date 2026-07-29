import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { Shadchan } from "../types";
import { ShadchanHeader } from "./ShadchanHeader";

/**
 * Story 3.1 AC 5 rewire coverage: `ShadchanHeader` composes its avatar chip
 * from the shared `EntityAvatar` (Epic 3 API contract §1 rule 6). See
 * `SingleProfileHeader.test.tsx` for why this direct render matters.
 */

const shadchan: Shadchan = {
  id: 1,
  account_id: 1,
  name: "Devorah Klein",
  created_at: "2026-01-01T00:00:00Z",
};

describe("ShadchanHeader", () => {
  it("renders the EntityAvatar chip with the density-pass size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(<ShadchanHeader shadchan={shadchan} />);
    const chip = screen.container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;

    // Assert — mobile-redesign-plan.md §4 S-C: h-14/w-14/rounded-2xl/text-lg
    // shrank to size-10/rounded-xl/text-sm.
    for (const token of ["size-10", "rounded-xl", "text-sm"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("DK");
  });

  it("falls back the meta line to book tenure when location is absent (sparse case)", async () => {
    // Arrange — no location at all, the common real-data shape.
    const sparse: Shadchan = {
      id: 2,
      account_id: 1,
      name: "Devorah Klein",
      created_at: "2026-01-01T00:00:00Z",
    };

    // Act
    const screen = await render(<ShadchanHeader shadchan={sparse} />);

    // Assert — the meta line is never empty even with no location.
    await expect.element(screen.getByText(/In your book since/)).toBeVisible();
  });

  it("does not throw when created_at is missing (freshly created via FakeRest, which does not stamp one)", async () => {
    // Arrange — reproduces a real crash caught live: FakeRest's generic
    // `create` never sets `created_at`, so a brand-new record violates the
    // (required-string) type at runtime. `as Shadchan` simulates that.
    const noCreatedAt = {
      id: 3,
      account_id: 1,
      name: "Mrs. New Shadchan",
    } as Shadchan;

    // Act
    const screen = await render(<ShadchanHeader shadchan={noCreatedAt} />);

    // Assert — degrades to the name only, never "Invalid time value".
    await expect
      .element(screen.getByRole("heading", { name: "Mrs. New Shadchan" }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/In your book since/))
      .not.toBeInTheDocument();
  });

  // Coverage note: a positive-path render (phone/WhatsApp/email quick-action
  // buttons) is intentionally not added here. Exercising it needs a fixture
  // that sets the jsonb field by its real name, and that literal token trips
  // the AD-23 retired-fossil-words guard (`scripts/retired-names.json`) —
  // out of this wave's declared file set to edit (the fix is a one-line
  // `exactFileAllowlist` addition mirroring the existing entry for
  // `shadchanUtils.test.ts`, which exercises the same field). The negative
  // path below covers the branch every real record hits today (no quick
  // actions have ever been seeded or entered — the create form has no input
  // for that field), and the rendering itself is a thin, deterministic
  // `Button asChild` + anchor mapping already used elsewhere in the app
  // (`ShidduchReferencesSection.tsx`).
  it("renders no quick-action buttons when the shadchan has no phone, WhatsApp or email on file", async () => {
    // Act
    const screen = await render(<ShadchanHeader shadchan={shadchan} />);

    // Assert
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";

import type { Reference, ReferenceLink } from "../types";
import { ShidduchReferencesSection } from "./ShidduchReferencesSection";

/**
 * Story 5.10, Task 2 (epic AC 2): each reference row in a shidduch's
 * Diligence tab states whether this is a first conversation or one of
 * several, from a single batched `references_summary` read
 * (`linked_shidduchim_count`) — never an N+1 fetch per row.
 */

const buildReference = (
  overrides: Partial<Reference> & Pick<Reference, "id">,
): Reference => ({
  account_id: 1,
  name_en: "Someone",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildLink = (
  overrides: Partial<ReferenceLink> &
    Pick<ReferenceLink, "id" | "reference_id">,
): ReferenceLink => ({
  account_id: 1,
  shidduchim_id: 100,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("ShidduchReferencesSection — first conversation vs one of several (Story 5.10, AC 2)", () => {
  it('labels a reference linked to only this shidduch as "First conversation"', async () => {
    // Arrange — reference 1 has exactly one link, to shidduch 100 (the
    // current one), so linked_shidduchim_count resolves to 1.
    const screen = await render(
      <StoryWrapper
        data={{
          references: [buildReference({ id: 1, name_en: "Chaya Cohen" })],
          reference_links: [
            buildLink({ id: 1, reference_id: 1, shidduchim_id: 100 }),
          ],
          // `reference_links_summary`'s FakeRest mirror joins `shidduchim`
          // and `singles` even for a non-empty link list — both must be
          // present (even empty) or FakeRest throws "Undefined collection".
          shidduchim: [],
          singles: [],
        }}
      >
        <ShidduchReferencesSection shidduchimId={100} />
      </StoryWrapper>,
    );

    // Assert
    await expect.element(screen.getByText("Chaya Cohen")).toBeInTheDocument();
    await expect
      .element(screen.getByText("First conversation"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Spoken to before"))
      .not.toBeInTheDocument();
  });

  it('labels a reference linked to another shidduch too as "Spoken to before"', async () => {
    // Arrange — reference 2 has TWO links: this shidduch (100) and a
    // different one (200), so linked_shidduchim_count resolves to 2.
    const screen = await render(
      <StoryWrapper
        data={{
          references: [buildReference({ id: 2, name_en: "Rivka Weiss" })],
          reference_links: [
            buildLink({ id: 2, reference_id: 2, shidduchim_id: 100 }),
            buildLink({ id: 3, reference_id: 2, shidduchim_id: 200 }),
          ],
          shidduchim: [],
          singles: [],
        }}
      >
        <ShidduchReferencesSection shidduchimId={100} />
      </StoryWrapper>,
    );

    // Assert
    await expect.element(screen.getByText("Rivka Weiss")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Spoken to before"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("First conversation"))
      .not.toBeInTheDocument();
  });

  it("renders the empty state with no fetch for the badge when nobody has been asked yet", async () => {
    // Arrange / Act
    const screen = await render(
      <StoryWrapper data={{ references: [], reference_links: [] }}>
        <ShidduchReferencesSection shidduchimId={100} />
      </StoryWrapper>,
    );

    // Assert
    await expect
      .element(screen.getByText("Nobody has been asked about this single yet."))
      .toBeInTheDocument();
  });
});

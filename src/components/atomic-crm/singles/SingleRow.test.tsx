import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import type { Single } from "../types";
// Side-effect import — registers the real `singles` descriptor so
// `SingleRow`'s `RecordLink` resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { SingleRow } from "./SingleRow";

/**
 * `.claude/rules/testing.md`'s 80%-new-code floor, applied to `SingleRow`
 * even though the story only names `ShadchanRow.test.tsx` explicitly — this
 * component is just as new.
 */

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 1,
  account_id: 1,
  first_name_en: "Chaim",
  last_name_en: "Cohen",
  status: "active",
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("SingleRow — the List-mode counterpart to SingleCard (Story 4.2, AC 1)", () => {
  it("renders a RecordLink to the single's real record path, with the single's name", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <SingleRow single={buildSingle({ id: 42 })} index={0} />
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByRole("link", { name: /Chaim Cohen/ }))
      .toHaveAttribute("href", "/singles/42/show");
  });

  it("shows the status label", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <SingleRow single={buildSingle({ status: "archived" })} index={0} />
      </TestMemoryRouter>,
    );

    // Assert
    await expect.element(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("shows the pipeline-count chip when openCount is positive", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <SingleRow single={buildSingle()} index={0} openCount={3} />
      </TestMemoryRouter>,
    );

    // Assert
    await expect.element(screen.getByText("3 in pipeline")).toBeInTheDocument();
  });

  it("hides the pipeline-count chip when openCount is zero or absent", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <SingleRow single={buildSingle()} index={0} openCount={0} />
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText(/in pipeline/))
      .not.toBeInTheDocument();
  });
});

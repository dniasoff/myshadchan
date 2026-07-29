import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityListViewMode } from "./useEntityListViewMode";
import { EntityListViewToggle } from "./EntityListViewToggle";

const renderToggle = async (mode: EntityListViewMode, onChange = vi.fn()) => {
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <EntityListViewToggle mode={mode} onChange={onChange} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onChange };
};

describe("EntityListViewToggle — controlled two-button control (AC 2)", () => {
  it("both buttons have accessible names", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("cards");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toBeInTheDocument();
  });

  it("aria-pressed reflects mode='list'", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("list");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("aria-pressed reflects mode='cards'", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("cards");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the List button calls onChange('list')", async () => {
    // Arrange
    const { screen, onChange } = await renderToggle("cards");

    // Act
    await screen.getByRole("button", { name: "List view" }).click();

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("clicking the Cards button calls onChange('cards')", async () => {
    // Arrange
    const { screen, onChange } = await renderToggle("list");

    // Act
    await screen.getByRole("button", { name: "Cards view" }).click();

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("cards");
  });

  // Adversarial-review fix (minor): the two buttons each had their own
  // accessible name already, but nothing told assistive tech they form one
  // segmented control rather than two unrelated buttons.
  it("exposes the two buttons as one labelled group", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("cards");

    // Assert
    await expect
      .element(screen.getByRole("group", { name: "View mode" }))
      .toBeInTheDocument();
  });
});

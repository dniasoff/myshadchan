import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { TaskAssigneeScope } from "./useTaskAssigneeScope";
import { TaskScopeToggle } from "./TaskScopeToggle";

const renderToggle = async (scope: TaskAssigneeScope, onChange = vi.fn()) => {
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <TaskScopeToggle scope={scope} onChange={onChange} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onChange };
};

describe("TaskScopeToggle — controlled two-button control (AC-2)", () => {
  it("both buttons have accessible names", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("everyone");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Everyone" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Assigned to me" }))
      .toBeInTheDocument();
  });

  it("aria-pressed reflects scope='everyone'", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("everyone");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Everyone" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Assigned to me" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("aria-pressed reflects scope='mine'", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("mine");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Everyone" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { name: "Assigned to me" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clicking 'Assigned to me' calls onChange('mine')", async () => {
    // Arrange
    const { screen, onChange } = await renderToggle("everyone");

    // Act
    await screen.getByRole("button", { name: "Assigned to me" }).click();

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("mine");
  });

  it("clicking 'Everyone' calls onChange('everyone')", async () => {
    // Arrange
    const { screen, onChange } = await renderToggle("mine");

    // Act
    await screen.getByRole("button", { name: "Everyone" }).click();

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("everyone");
  });

  it("exposes the two buttons as one labelled group", async () => {
    // Arrange / Act
    const { screen } = await renderToggle("everyone");

    // Assert
    await expect
      .element(screen.getByRole("group", { name: "Task scope" }))
      .toBeInTheDocument();
  });
});

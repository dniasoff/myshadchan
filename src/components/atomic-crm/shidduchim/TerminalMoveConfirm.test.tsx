import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TerminalMoveConfirm } from "./TerminalMoveConfirm";

/**
 * Task 9: "choosing a terminal destination does not call transitionShidduch
 * until confirmed; confirming calls it exactly once with the reason as the
 * 4th argument; Cancel calls it zero times." `TerminalMoveConfirm` itself is
 * dataProvider-agnostic (Task 5) — the one call into `transitionShidduch`
 * lives in `useShidduchTransition`'s `move()`, reached only through this
 * component's `onConfirm` prop (`ShidduchMoveSheet`'s wiring). The property
 * under test here — `onConfirm`'s call count and timing — is that same
 * guarantee, one layer below the RPC call itself.
 */
describe("TerminalMoveConfirm — the confirm step ahead of an irreversible move (AC-9)", () => {
  it("does not call onConfirm merely by opening — only an explicit Confirm tap does", async () => {
    // Arrange
    const onConfirm = vi.fn();

    // Act
    await render(
      <TerminalMoveConfirm
        toState="yes"
        name="Chaya Cohen"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Assert
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm exactly once, with the typed reason, when Confirm is tapped", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const screen = await render(
      <TerminalMoveConfirm
        toState="yes"
        name="Chaya Cohen"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Act
    await screen.getByLabelText("Why? (optional)").fill("Great match on paper");
    await screen.getByRole("button", { name: /Confirm/ }).click();

    // Assert
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Great match on paper");
  });

  it("passes undefined when the optional reason is left blank", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const screen = await render(
      <TerminalMoveConfirm
        toState="no"
        name="Chaya Cohen"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Act
    await screen.getByRole("button", { name: /Confirm/ }).click();

    // Assert
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("calls onConfirm zero times when Cancel is tapped", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const screen = await render(
      <TerminalMoveConfirm
        toState="yes"
        name="Chaya Cohen"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    // Act
    await screen.getByRole("button", { name: "Cancel" }).click();

    // Assert
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders no dialog content when toState is null", async () => {
    // Arrange / Act
    const screen = await render(
      <TerminalMoveConfirm
        toState={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: /Confirm/ }))
      .not.toBeInTheDocument();
  });
});

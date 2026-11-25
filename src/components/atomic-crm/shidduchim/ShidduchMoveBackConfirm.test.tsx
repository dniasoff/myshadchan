import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ShidduchMoveBackConfirm } from "./ShidduchMoveBackConfirm";

describe("ShidduchMoveBackConfirm", () => {
  it("requires explicit confirmation and explains the New visibility change", async () => {
    const onConfirm = vi.fn();
    const screen = await render(
      <ShidduchMoveBackConfirm
        move={{ from_state: "new", to_state: "look_into" }}
        name="Chaya Cohen"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    await expect
      .element(
        screen.getByText(
          "Going back to New hides this suggestion from the child.",
        ),
      )
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Back to New" }).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls Cancel without moving the suggestion", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const screen = await render(
      <ShidduchMoveBackConfirm
        move={{ from_state: "look_into", to_state: "yes" }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

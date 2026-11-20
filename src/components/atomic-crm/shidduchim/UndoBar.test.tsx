import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "@/index.css";

import { UndoBar } from "./UndoBar";
import { SHIDDUCH_UNDO_MS } from "./useShidduchUndo";

const move = {
  id: 7,
  from: "look_into" as const,
  to: "yes" as const,
  movedAt: Date.now(),
};

describe("UndoBar", () => {
  it("keeps the visible window at ten seconds", () => {
    expect(SHIDDUCH_UNDO_MS).toBe(10_000);
  });

  it("announces a ten-second Undo affordance with a touch-sized button", async () => {
    const screen = await render(
      <UndoBar
        move={move}
        remaining={SHIDDUCH_UNDO_MS}
        busy={false}
        undo={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        "Moved to Yes (final).Undo is available for 10 seconds.",
      );
    const undo = screen
      .getByRole("button", { name: "Undo move to Yes (final)" })
      .element();
    expect(undo.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect
      .element(screen.getByRole("progressbar"))
      .toHaveAttribute("aria-valuenow", "100");
  });

  it("renders no bar after the visible window expires", async () => {
    const screen = await render(
      <UndoBar
        move={move}
        remaining={0}
        busy={false}
        undo={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });
});

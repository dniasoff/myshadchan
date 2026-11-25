import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ShidduchStateControl } from "./ShidduchStateControl";
import { useShidduchMoveBack } from "./useShidduchMoveBack";

vi.mock("./useShidduchMoveBack");
vi.mock("./useShidduchTransition", () => ({
  classifySelection: () => "noop",
  isTerminalPipelineState: () => false,
  useShidduchTransition: () => ({
    options: [],
    pendingTo: null,
    move: vi.fn(),
  }),
}));

const mockedUseShidduchMoveBack = vi.mocked(useShidduchMoveBack);

const setMoveBackState = (
  state: Partial<ReturnType<typeof useShidduchMoveBack>> = {},
) => {
  mockedUseShidduchMoveBack.mockReturnValue({
    move: null,
    loading: false,
    loadError: null,
    busy: false,
    reload: vi.fn().mockResolvedValue(undefined),
    moveBack: vi.fn().mockResolvedValue(undefined),
    ...state,
  });
};

describe("ShidduchStateControl move-back affordance", () => {
  beforeEach(() => {
    setMoveBackState();
  });

  it("does not show an empty state while history is loading", async () => {
    setMoveBackState({ loading: true });

    const screen = await render(
      <ShidduchStateControl id="shidduch-1" currentState="look_into" />,
    );

    await expect
      .element(screen.getByText("Nothing to move back yet."))
      .not.toBeInTheDocument();
  });

  it("explains when there is no move to reverse after history loads", async () => {
    const screen = await render(
      <ShidduchStateControl id="shidduch-1" currentState="new" />,
    );

    await expect
      .element(screen.getByText("Nothing to move back yet."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Back to/ }))
      .not.toBeInTheDocument();
  });

  it("shows a read error with retry and recovers without claiming there is no history", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    setMoveBackState({
      loadError: "Could not read this suggestion's move history.",
      reload,
    });

    const screen = await render(
      <ShidduchStateControl id="shidduch-1" currentState="look_into" />,
    );

    await expect
      .element(
        screen.getByText(
          "Could not read this suggestion's move history. Try again to check whether this suggestion can move back.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Nothing to move back yet."))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Try again" }).click();
    expect(reload).toHaveBeenCalledOnce();

    setMoveBackState();
    await screen.rerender(
      <ShidduchStateControl id="shidduch-1" currentState="look_into" />,
    );
    await expect
      .element(screen.getByText("Nothing to move back yet."))
      .toBeInTheDocument();
  });

  it("names the reversible last move and its target", async () => {
    setMoveBackState({
      move: { from_state: "new", to_state: "look_into" },
    });

    const screen = await render(
      <ShidduchStateControl id="shidduch-1" currentState="look_into" />,
    );

    await expect
      .element(screen.getByText("Last move can be reversed."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("You can move this suggestion back one step."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Back to New" }))
      .toBeInTheDocument();
  });
});

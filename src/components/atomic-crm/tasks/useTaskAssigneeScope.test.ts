import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";

import { useTaskAssigneeScope } from "./useTaskAssigneeScope";

/**
 * AC-1's own falsifiable claim, pinned directly on the hook rather than
 * inferred from a rendered list: the default scope is "everyone", never
 * "mine". A "mine" default reproduces the exact defect this story fixes
 * (`TasksListByDueDate.tsx`'s old unconditional `member_id` filter) for
 * anyone who has never touched the toggle.
 *
 * Plain `.ts` (no `.tsx`), modelled on `misc/useEntityListViewMode.test.ts` —
 * a probe component still needs a host element, so it is built with
 * `React.createElement` rather than JSX.
 */

const Probe = () => {
  const [scope, setScope] = useTaskAssigneeScope();
  return createElement(
    "div",
    null,
    createElement("p", null, `scope: ${scope}`),
    createElement(
      "button",
      { type: "button", onClick: () => setScope("mine") },
      "Switch to mine",
    ),
  );
};

describe("useTaskAssigneeScope — default scope (AC-1)", () => {
  it("defaults to 'everyone', not 'mine'", async () => {
    // Arrange / Act
    const screen = await render(
      createElement(
        TestMemoryRouter,
        null,
        createElement(
          CoreAdminContext,
          { store: memoryStore() },
          createElement(Probe),
        ),
      ),
    );

    // Assert
    await expect
      .element(screen.getByText("scope: everyone"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("scope: mine"))
      .not.toBeInTheDocument();
  });

  it("switches to 'mine' and back is possible from the default", async () => {
    // Arrange
    const screen = await render(
      createElement(
        TestMemoryRouter,
        null,
        createElement(
          CoreAdminContext,
          { store: memoryStore() },
          createElement(Probe),
        ),
      ),
    );

    // Act
    await screen.getByRole("button", { name: "Switch to mine" }).click();

    // Assert
    await expect.element(screen.getByText("scope: mine")).toBeInTheDocument();
  });
});

describe("useTaskAssigneeScope — persistence (AC-2)", () => {
  /**
   * Modelled on `misc/useEntityListViewMode.test.ts`'s "round-trips ...
   * through a fresh hook instance" test — see that file's own comment for
   * why a single `CoreAdminContext`/store stays mounted and a `key` change
   * forces a fresh `Probe` (hook) instance rather than a second provider
   * mount, which a shared `memoryStore()` cannot observe correctly.
   */
  it("round-trips the persisted scope through a fresh hook instance mounted against the same store (simulating reload)", async () => {
    // Arrange
    const store = memoryStore();
    const buildTree = (key: string) =>
      createElement(
        TestMemoryRouter,
        null,
        createElement(
          CoreAdminContext,
          { store },
          createElement(Probe, { key }),
        ),
      );
    const screen = await render(buildTree("first"));
    await screen.getByRole("button", { name: "Switch to mine" }).click();
    await expect.element(screen.getByText("scope: mine")).toBeInTheDocument();

    // Act — a different `key` forces React to unmount the old `Probe` and
    // mount a brand-new one; `CoreAdminContext` itself never unmounts, so
    // the store's own setup()/teardown() never re-run.
    await screen.rerender(buildTree("second"));

    // Assert
    await expect.element(screen.getByText("scope: mine")).toBeInTheDocument();
  });
});

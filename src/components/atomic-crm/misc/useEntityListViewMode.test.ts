import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";

import { useEntityListViewMode } from "./useEntityListViewMode";

/**
 * AC 3's own falsification checks: switching one resource's mode must not
 * touch another resource's, and the value must survive a fresh mount against
 * the same store (simulating a page reload) — never just component state.
 *
 * Plain `.ts` (no `.tsx`) per this file's declared name (Task 1) — a probe
 * component still needs a host element, so it is built with
 * `React.createElement` rather than JSX.
 */

const Probe = ({ resource }: { resource: string }) => {
  const [mode, setMode] = useEntityListViewMode(resource, "cards");
  return createElement(
    "div",
    null,
    createElement("p", null, `${resource}: ${mode}`),
    createElement(
      "button",
      { type: "button", onClick: () => setMode("list") },
      `Switch ${resource} to list`,
    ),
  );
};

const renderProbe = (store: Store, resource: string) =>
  render(
    createElement(
      TestMemoryRouter,
      null,
      createElement(
        CoreAdminContext,
        { store },
        createElement(Probe, { resource }),
      ),
    ),
  );

describe("useEntityListViewMode — per-resource persistence (AC 3)", () => {
  it("setting mode for resource 'a' does not affect resource 'b''s stored mode", async () => {
    // Arrange
    const store = memoryStore();
    const screenA = await renderProbe(store, "a");
    const screenB = await renderProbe(store, "b");
    await expect.element(screenA.getByText("a: cards")).toBeInTheDocument();
    await expect.element(screenB.getByText("b: cards")).toBeInTheDocument();

    // Act
    await screenA.getByRole("button", { name: "Switch a to list" }).click();

    // Assert
    await expect.element(screenA.getByText("a: list")).toBeInTheDocument();
    await expect.element(screenB.getByText("b: cards")).toBeInTheDocument();
  });

  it("round-trips the persisted mode through a fresh hook instance mounted against the same store (simulating reload)", async () => {
    // Arrange
    const store = memoryStore();
    const first = await renderProbe(store, "shadchanim");
    await first
      .getByRole("button", { name: "Switch shadchanim to list" })
      .click();
    await expect
      .element(first.getByText("shadchanim: list"))
      .toBeInTheDocument();

    // Act — a fresh mount against the same store stands in for a reload.
    const second = await renderProbe(store, "shadchanim");

    // Assert
    await expect
      .element(second.getByText("shadchanim: list"))
      .toBeInTheDocument();
  });
});

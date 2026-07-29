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

/**
 * Review fix (adversarial review): `render()`'s own default `baseElement`
 * is `document.body`, shared by every call that does not override it — so
 * two `renderProbe()` calls in the same test resolve `getByText` against
 * the *whole body*, not just the render it was called on. Each probe here
 * gets its own dedicated host element for exactly that reason: it is what
 * makes "round-trips ... through a fresh hook instance" test the second
 * mount's own DOM rather than silently re-matching the first's.
 *
 * `unmount()` was considered instead and rejected: `CoreAdminContext`'s
 * `StoreContextProvider` calls `store.teardown()` — which clears the
 * store's entire contents — on unmount (`ra-core/src/store/
 * StoreContextProvider.tsx`). Two probes sharing one `store` means
 * unmounting the first would wipe the persisted value before the second
 * ever reads it, which is a correct *store* running the real reset
 * `Admin`/`CoreAdminContext` does on teardown, but not a reload — a reload
 * keeps the backing localStorage/memory intact. A dedicated `baseElement`
 * avoids the false failure this would have produced without reintroducing
 * the cross-render leakage this fix is for.
 */
const renderProbe = (store: Store, resource: string) => {
  const baseElement = document.body.appendChild(document.createElement("div"));
  return render(
    createElement(
      TestMemoryRouter,
      null,
      createElement(
        CoreAdminContext,
        { store },
        createElement(Probe, { resource }),
      ),
    ),
    { baseElement },
  );
};

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

  /**
   * Review fix (adversarial review): this test used to render a SECOND,
   * independent `CoreAdminContext` against the same `store` to "simulate
   * reload" — and that mechanism is broken two ways over, not one.
   *
   * 1. (The bug the review caught.) `render()`'s default `baseElement` is
   *    the shared `document.body`, so the second mount's `getByText`
   *    resolved against the *first* mount's still-mounted DOM. Replacing
   *    the whole hook body with `useState(defaultMode)` (no persistence at
   *    all) still passed.
   * 2. (Found while fixing #1, with a dedicated `baseElement` per mount —
   *    see `renderProbe` above — which closes #1 but does not close this.)
   *    `memoryStore()`'s `setup()` is unconditional, not additive
   *    (`ra-core/src/store/memoryStore.tsx`): every `StoreContextProvider`
   *    mount that shares a `store` instance re-runs `Store.setup()`,
   *    which resets `storage` from the store's *original* (empty)
   *    snapshot — discarding the "list" value the first mount just wrote,
   *    even with no unmount involved. A second `CoreAdminContext` mount
   *    against a shared `memoryStore()` therefore can never see the first
   *    mount's write, regardless of the test's own scoping — this would
   *    fail against the REAL hook, not just the mutant.
   *
   * The fix keeps the single `CoreAdminContext`/`StoreContextProvider`
   * mounted throughout (so `store.setup()` runs exactly once) and instead
   * forces a truly fresh `Probe` instance — a new call to
   * `useEntityListViewMode`'s `useState` initializer — via React's own
   * remount-on-`key`-change behaviour. That is a closer match for "fresh
   * hook instance against the same store" than a second provider mount
   * ever was, and it is what the real app does on a reload: `root/
   * crmStore.ts`'s `localStorageStore()` reads real, already-persisted
   * `window.localStorage` on every fresh mount; nothing re-initialises it.
   */
  it("round-trips the persisted mode through a fresh hook instance mounted against the same store (simulating reload)", async () => {
    // Arrange
    const store = memoryStore();
    const buildTree = (key: string) =>
      createElement(
        TestMemoryRouter,
        null,
        createElement(
          CoreAdminContext,
          { store },
          createElement(Probe, { resource: "shadchanim", key }),
        ),
      );
    const screen = await render(buildTree("first"));
    await screen
      .getByRole("button", { name: "Switch shadchanim to list" })
      .click();
    await expect
      .element(screen.getByText("shadchanim: list"))
      .toBeInTheDocument();

    // Act — a different `key` forces React to unmount the old `Probe` and
    // mount a brand-new one in its place; `CoreAdminContext` itself never
    // unmounts, so `store.setup()`/`teardown()` never re-run.
    await screen.rerender(buildTree("second"));

    // Assert
    await expect
      .element(screen.getByText("shadchanim: list"))
      .toBeInTheDocument();
  });
});

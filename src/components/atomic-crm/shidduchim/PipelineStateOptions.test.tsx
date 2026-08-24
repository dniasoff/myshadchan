import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "@/index.css";

import { PIPELINE_STATES } from "./pipelineStates";
import { PipelineStateOptions } from "./PipelineStateOptions";
import type { PipelineStateOption } from "./useShidduchTransition";

/** Every state, from `new` — the shape the Shidduch 360 page renders. */
const optionsFromNew = (): PipelineStateOption[] =>
  PIPELINE_STATES.map((def) => ({
    state: def.value,
    label: def.label,
    group: def.group,
    isCurrent: def.value === "new",
    isAllowed: def.value === "new" || def.group === "triage",
    isTerminal: def.value !== "new" && def.value !== "look_into",
    reason:
      def.group === "decision" ? "Only reachable from Look-into." : undefined,
  }));

/**
 * Queries go through the render result's OWN locator, which is scoped to that
 * render's container — every state label is identical between renders, so a
 * document-wide query would go ambiguous as soon as a second test mounted.
 *
 * Deliberately no `cleanup()`/`unmount()` between tests: unmounting here left
 * every subsequent render unqueryable (each later locator timed out at 15s
 * against a container that demonstrably held all seven buttons). Scoping
 * makes the extra copies harmless, so nothing needs tearing down.
 */
const renderAt = async (orientation: "list" | "row", width: number) => {
  const result = await render(
    <div style={{ width: `${width}px` }}>
      <PipelineStateOptions
        options={optionsFromNew()}
        pendingTo={null}
        onSelect={vi.fn()}
        orientation={orientation}
      />
    </div>,
  );
  return { ...result, screen: result };
};

describe("PipelineStateOptions", () => {
  it("costs far less vertical space as a row than as a list", async () => {
    // The reason this prop exists. At a laptop's content width the list form
    // stacked seven full-width rows and pushed the facts, the resume and the
    // single's input below the fold. Measured rather than asserted by eye —
    // and measured as a RATIO, so it cannot be satisfied by both forms
    // happening to be small in a test viewport.
    const list = await renderAt("list", 900);
    const listHeight = list.container.getBoundingClientRect().height;

    const row = await renderAt("row", 900);
    const rowHeight = row.container.getBoundingClientRect().height;

    expect(rowHeight).toBeGreaterThan(0);
    expect(rowHeight).toBeLessThan(listHeight / 2);
  });

  it("still offers every state, with the same accessible names", async () => {
    // Layout may change; the model AC-8 fixed may not. All seven stay
    // reachable, and the name each one answers to is unchanged, which is what
    // `ShidduchMoveSheet`'s own suite matches on.
    const { screen } = await renderAt("row", 900);

    for (const def of PIPELINE_STATES) {
      await expect
        .element(
          screen.getByRole("button", {
            name: new RegExp(`^${def.label}\\b`),
          }),
        )
        .toBeVisible();
    }
  });

  it("keeps an illegal destination present, focusable and explained", async () => {
    // AC-8's rule: legality never hides a row, and never uses the native
    // `disabled` attribute, which would drop it from the accessibility tree.
    // The row form drops the visible reason line for height, so the reason
    // has to survive on the element itself.
    const { screen } = await renderAt("row", 900);
    const yes = screen.getByRole("button", { name: /^Yes\b/ });

    await expect.element(yes).toHaveAttribute("aria-disabled", "true");
    await expect.element(yes).not.toHaveAttribute("disabled");
    await expect
      .element(yes)
      .toHaveAttribute("title", expect.stringContaining("Only reachable from"));

    yes.element().focus();
    expect(document.activeElement).toBe(yes.element());
  });

  it("marks the current stage without spending a line on saying so", async () => {
    const { screen } = await renderAt("row", 900);

    await expect
      .element(screen.getByRole("button", { name: /^New\b/ }))
      .toHaveAttribute("aria-current", "step");
    // "Current stage" is the secondary line the row form drops; the check
    // mark and `aria-current` carry it instead.
    expect(screen.getByText("Current stage").query()).toBeNull();
  });

  it("leaves the list form — the bottom sheet's shape — exactly as it was", async () => {
    const { screen } = await renderAt("list", 420);

    await expect.element(screen.getByText("Current stage")).toBeVisible();
    await expect
      .element(screen.getByText("Only reachable from Look-into.").first())
      .toBeVisible();
  });
});

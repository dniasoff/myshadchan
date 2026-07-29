import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { PipelineState } from "../types";
import { ShidduchMoveSheet } from "./ShidduchMoveSheet";

/** `\b` after the label avoids "No" matching "Not-sure"'s row by prefix. */
const stateButton = (
  screen: Awaited<ReturnType<typeof render>>,
  label: string,
) => screen.getByRole("button", { name: new RegExp(`^${label}\\b`) });

const renderSheet = (
  currentState: PipelineState,
  overrides: {
    transitionShidduch?: ReturnType<
      typeof vi.fn<(...args: unknown[]) => Promise<unknown>>
    >;
    onOpenChange?: ReturnType<typeof vi.fn<(open: boolean) => void>>;
  } = {},
) => {
  const transitionShidduch =
    overrides.transitionShidduch ?? vi.fn().mockResolvedValue({});
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const dataProvider = { transitionShidduch } as unknown as CrmDataProvider;

  return {
    transitionShidduch,
    onOpenChange,
    render: () =>
      render(
        <TestMemoryRouter>
          <CoreAdminContext
            dataProvider={dataProvider}
            i18nProvider={testI18nProvider}
          >
            <ShidduchMoveSheet
              open
              onOpenChange={onOpenChange}
              id={7}
              currentState={currentState}
              name="Chaya Cohen"
            />
          </CoreAdminContext>
        </TestMemoryRouter>,
      ),
  };
};

describe("ShidduchMoveSheet — two-tap Move surface (AC-8)", () => {
  it("makes exactly {Yes, Unsure, No} actionable from Look-into", async () => {
    // Arrange / Act
    const screen = await renderSheet("look_into").render();

    // Assert
    for (const label of ["Yes", "Unsure", "No"]) {
      await expect
        .element(stateButton(screen, label))
        .not.toHaveAttribute("aria-disabled");
    }
    for (const label of ["New", "Not-sure", "For-sure-not"]) {
      await expect
        .element(stateButton(screen, label))
        .toHaveAttribute("aria-disabled", "true");
    }
  });

  it("makes nothing actionable from No", async () => {
    // Arrange / Act
    const screen = await renderSheet("no").render();

    // Assert
    for (const label of [
      "New",
      "Look-into",
      "Not-sure",
      "For-sure-not",
      "Yes",
      "Unsure",
    ]) {
      await expect
        .element(stateButton(screen, label))
        .toHaveAttribute("aria-disabled", "true");
    }
  });

  it("keeps an illegal row focusable, with a visible reason", async () => {
    // Arrange
    const screen = await renderSheet("new").render();
    const yesRow = stateButton(screen, "Yes");

    // Assert — aria-disabled, not disabled: still in the a11y tree.
    await expect.element(yesRow).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(yesRow)
      .toHaveTextContent(/Only reachable from Look-into/);

    // Act
    yesRow.element().focus();

    // Assert — a `disabled` button could never receive focus.
    expect(document.activeElement).toBe(yesRow.element());
  });

  it("marks the four terminal rows '· final', and no others", async () => {
    // Arrange / Act
    const screen = await renderSheet("new").render();

    // Assert
    for (const label of ["For-sure-not", "Yes", "Unsure", "No"]) {
      await expect
        .element(stateButton(screen, label))
        .toHaveTextContent("· final");
    }
    for (const label of ["Look-into", "Not-sure"]) {
      await expect
        .element(stateButton(screen, label))
        .not.toHaveTextContent("· final");
    }
  });

  it("moves immediately for a legal non-terminal destination and closes the sheet", async () => {
    // Arrange
    const harness = renderSheet("new");
    const screen = await harness.render();

    // Act
    await stateButton(screen, "Look-into").click();

    // Assert
    await expect
      .poll(() => harness.transitionShidduch.mock.calls.length)
      .toBe(1);
    expect(harness.transitionShidduch).toHaveBeenCalledWith(
      7,
      "new",
      "look_into",
      undefined,
    );
    expect(harness.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens the terminal confirm — never transitionShidduch directly — for a terminal destination", async () => {
    // Arrange
    const harness = renderSheet("look_into");
    const screen = await harness.render();

    // Act
    await stateButton(screen, "Yes").click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: /^Confirm/ }))
      .toBeInTheDocument();
    expect(harness.transitionShidduch).not.toHaveBeenCalled();
  });

  it("fires the existing warning notify() for an illegal tap, without opening the sheet's close callback", async () => {
    // Arrange
    const harness = renderSheet("new");
    const screen = await harness.render();

    // Act — Yes is illegal from New. `force: true` bypasses Playwright's own
    // aria-disabled-aware actionability check — the row is deliberately
    // still clickable (AC-8: aria-disabled, not disabled), just not through
    // an ordinary un-forced click, which is exactly the property this test
    // needs to exercise.
    await stateButton(screen, "Yes").click({ force: true });

    // Assert — no write, and the sheet itself is not asked to close.
    expect(harness.transitionShidduch).not.toHaveBeenCalled();
    expect(harness.onOpenChange).not.toHaveBeenCalled();
  });
});

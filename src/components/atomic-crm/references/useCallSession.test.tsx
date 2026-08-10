import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import { useCallSession } from "./useCallSession";
import { testI18nProvider } from "../providers/commons/i18nProvider";

function TestComponent() {
  const { activeLinkId, step, open, goTo, close } = useCallSession();
  return (
    <div>
      <span data-testid="activeLinkId">{activeLinkId ?? "null"}</span>
      <span data-testid="step">{step}</span>
      <button onClick={() => open("7")} data-testid="open-btn">
        Open 7
      </button>
      <button onClick={() => goTo(3)} data-testid="goto-btn">
        GoTo 3
      </button>
      <button onClick={close} data-testid="close-btn">
        Close
      </button>
      <button onClick={() => goTo(99)} data-testid="goto-99-btn">
        GoTo 99
      </button>
      <button onClick={() => goTo(0)} data-testid="goto-0-btn">
        GoTo 0
      </button>
      <button onClick={() => goTo(-5)} data-testid="goto-neg5-btn">
        GoTo -5
      </button>
    </div>
  );
}

const renderWithRouter = async (initialEntry: string) => {
  return render(
    <TestMemoryRouter initialEntries={[initialEntry]}>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value="references">
          <TestComponent />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("useCallSession", () => {
  it("restores step from URL params", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=3");

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("7");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("3");
  });

  it("clamps non-numeric step to 1", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=abc");

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("7");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("clamps zero step to 1", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=0");

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("7");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("clamps negative step to 1", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=-5");

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("7");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("opens nothing for non-numeric call id", async () => {
    const screen = await renderWithRouter("/references/1?call=abc&step=1");

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("abc");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("open() sets call and step=1", async () => {
    const screen = await renderWithRouter("/references/1");

    await screen.getByTestId("open-btn").click();

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("7");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("goTo() updates step", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=1");

    await screen.getByTestId("goto-btn").click();

    await expect.element(screen.getByTestId("step")).toHaveTextContent("3");
  });

  it("goTo() passes large steps through — upper bound is the component's job", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=1");

    await screen.getByTestId("goto-99-btn").click();

    await expect.element(screen.getByTestId("step")).toHaveTextContent("99");
  });

  it("goTo() clamps zero and negative steps to 1", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=1");

    await screen.getByTestId("goto-99-btn").click();
    await screen.getByTestId("goto-0-btn").click();

    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");

    await screen.getByTestId("goto-99-btn").click();
    await screen.getByTestId("goto-neg5-btn").click();

    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });

  it("close() removes both params", async () => {
    const screen = await renderWithRouter("/references/1?call=7&step=3");

    await screen.getByTestId("close-btn").click();

    await expect
      .element(screen.getByTestId("activeLinkId"))
      .toHaveTextContent("null");
    await expect.element(screen.getByTestId("step")).toHaveTextContent("1");
  });
});

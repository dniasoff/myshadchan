import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  RETURN_FROM_CALL_STORAGE_KEY,
  useReturnFromCall,
} from "./useReturnFromCall";

const TestHook = ({ referenceKey }: { referenceKey?: string }) => {
  const { arm, isPromptOpen, dismiss } = useReturnFromCall(referenceKey);
  return (
    <div>
      <button type="button" onClick={arm}>
        Arm
      </button>
      <button type="button" onClick={dismiss}>
        Skip
      </button>
      <span data-testid="prompt-state">{isPromptOpen ? "open" : "closed"}</span>
    </div>
  );
};

const setVisibility = (state: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("useReturnFromCall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
    window.sessionStorage.clear();
    setVisibility("visible");
  });

  it("requires a real hidden-then-visible return of five seconds", async () => {
    const screen = await render(<TestHook referenceKey="link-1" />);
    await screen.getByRole("button", { name: "Arm" }).click();

    setVisibility("hidden");
    vi.advanceTimersByTime(4_999);
    setVisibility("visible");
    await expect
      .element(screen.getByTestId("prompt-state"))
      .toHaveTextContent("closed");

    // A new tap gets a new eligibility window.
    await screen.getByRole("button", { name: "Arm" }).click();
    setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    setVisibility("visible");
    await expect
      .element(screen.getByTestId("prompt-state"))
      .toHaveTextContent("open");
  });

  it("does not prompt without a hidden state or after thirty minutes", async () => {
    const screen = await render(<TestHook referenceKey="link-1" />);
    await screen.getByRole("button", { name: "Arm" }).click();
    vi.advanceTimersByTime(6_000);
    await expect
      .element(screen.getByTestId("prompt-state"))
      .toHaveTextContent("closed");

    setVisibility("hidden");
    vi.advanceTimersByTime(30 * 60 * 1_000 + 1);
    setVisibility("visible");
    await expect
      .element(screen.getByTestId("prompt-state"))
      .toHaveTextContent("closed");
  });

  it("stores only the reference key and timestamps, and Skip clears it", async () => {
    const screen = await render(<TestHook referenceKey="link-1" />);
    await screen.getByRole("button", { name: "Arm" }).click();
    const stored = window.sessionStorage.getItem(RETURN_FROM_CALL_STORAGE_KEY);
    expect(stored).toContain('"referenceKey":"link-1"');
    expect(stored).toContain('"tappedAt"');
    expect(stored).not.toContain("phone");
    expect(stored).not.toContain("Rivka");

    await screen.getByRole("button", { name: "Skip" }).click();
    expect(window.sessionStorage.getItem(RETURN_FROM_CALL_STORAGE_KEY)).toBe(
      null,
    );
  });
});

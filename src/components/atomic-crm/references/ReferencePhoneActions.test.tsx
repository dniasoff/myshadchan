import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ReferencePhoneActions } from "./ReferencePhoneActions";

const setMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
};

describe("ReferencePhoneActions", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setMatchMedia(true);
  });

  it("renders safe Call and WhatsApp hrefs without changing display text", async () => {
    const screen = await render(
      <ReferencePhoneActions
        phone="(732) 930-6891"
        referenceName="Rivka Levi"
      />,
    );

    await expect.element(screen.getByText("(732) 930-6891")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi" }))
      .toHaveAttribute("href", "tel:+17329306891");
    await expect
      .element(screen.getByRole("link", { name: "WhatsApp Rivka Levi" }))
      .toHaveAttribute("href", "https://wa.me/17329306891");
  });

  it("shows the gentle invalid-number state and no broken links", async () => {
    const screen = await render(
      <ReferencePhoneActions
        phone="javascript:alert(1)"
        referenceName="Rivka Levi"
        onEdit={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByText("Check this number before calling"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Edit number" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /Call/i }))
      .not.toBeInTheDocument();
  });

  it("does not guess across multiple numbers and keeps desktop copy available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const phone = "732-930-6891; 201-555-0100";
    const screen = await render(
      <ReferencePhoneActions phone={phone} referenceName="Rivka Levi" />,
    );

    await expect
      .element(screen.getByText("Check this number before calling"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /Call/i }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Copy number" }).click();
    expect(writeText).toHaveBeenCalledWith(phone);
  });

  it("renders no phone actions when there is no number", async () => {
    const screen = await render(
      <ReferencePhoneActions phone={null} referenceName="Rivka Levi" />,
    );
    await expect.element(screen.getByText("No number yet")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /Call/i }))
      .not.toBeInTheDocument();
  });

  it("keeps Copy number on fine pointers and reports only Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const screen = await render(
      <ReferencePhoneActions phone="732-930-6891" referenceName="Rivka Levi" />,
    );

    await screen.getByRole("button", { name: "Copy number" }).click();
    expect(writeText).toHaveBeenCalledWith("732-930-6891");
    await expect
      .element(screen.getByRole("button", { name: "Copied" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copied" }))
      .toHaveTextContent("Copied");
  });

  it("hides Copy number on coarse pointers while leaving both call actions", async () => {
    setMatchMedia(false);
    const screen = await render(
      <ReferencePhoneActions phone="732-930-6891" referenceName="Rivka Levi" />,
    );
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "WhatsApp Rivka Levi" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copy number" }))
      .not.toBeInTheDocument();
  });
});

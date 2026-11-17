import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import type { ReferenceLinkSummary } from "../types";
import { ReferencePhoneActions } from "./ReferencePhoneActions";

const returnFlow = vi.hoisted(() => ({
  arm: vi.fn(),
  dismiss: vi.fn(),
  isPromptOpen: false,
}));

vi.mock("./useReturnFromCall", () => ({
  useReturnFromCall: () => returnFlow,
}));

vi.mock("./CallCaptureSheet", () => ({
  CallCaptureSheet: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onOpenChange(false)}>
        Close return sheet
      </button>
    ) : null,
}));

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
  afterEach(async () => {
    await page.viewport(1280, 720);
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    setMatchMedia(true);
    returnFlow.arm.mockClear();
    returnFlow.dismiss.mockClear();
    returnFlow.isPromptOpen = false;
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
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 1" }))
      .toHaveAttribute("href", "tel:+17329306891");
    await expect
      .element(
        screen.getByRole("link", { name: "WhatsApp Rivka Levi, number 1" }),
      )
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

  it("splits explicit separators into independently actionable numbers", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const phone = "732-930-6891; 201-555-0100";
    const screen = await render(
      <ReferencePhoneActions phone={phone} referenceName="Rivka Levi" />,
    );

    await expect.element(screen.getByText("732-930-6891")).toBeVisible();
    await expect.element(screen.getByText("201-555-0100")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 1" }))
      .toHaveAttribute("href", "tel:+17329306891");
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 2" }))
      .toHaveAttribute("href", "tel:+12015550100");
    await expect
      .element(
        screen.getByRole("link", {
          name: "WhatsApp Rivka Levi, number 2",
        }),
      )
      .toHaveAttribute("href", "https://wa.me/12015550100");
    await screen
      .getByRole("button", { name: "Copy Rivka Levi, number 2" })
      .click();
    expect(writeText).toHaveBeenCalledWith("201-555-0100");
  });

  it("keeps valid parts actionable when another separated part is hostile", async () => {
    const screen = await render(
      <ReferencePhoneActions
        phone="732-930-6891; javascript:alert(1)"
        referenceName="Rivka Levi"
      />,
    );

    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 1" }))
      .toBeVisible();
    await expect.element(screen.getByText("javascript:alert(1)")).toBeVisible();
    await expect
      .element(screen.getByText("Check this number before calling"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 2" }))
      .not.toBeInTheDocument();
  });

  it("caps actionable parts at three and keeps extras as text", async () => {
    const screen = await render(
      <ReferencePhoneActions
        phone="732-930-6891, 201-555-0100, 212-555-0100, 646-555-0100"
        referenceName="Rivka Levi"
      />,
    );

    for (const number of [1, 2, 3]) {
      await expect
        .element(
          screen.getByRole("link", {
            name: `Call Rivka Levi, number ${number}`,
          }),
        )
        .toBeVisible();
    }
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 4" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByTestId("reference-phone-extra-numbers"))
      .toHaveTextContent("646-555-0100");
  });

  it("keeps an unsplittable odd value on the conservative fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const phone = "732-930-6891 201-555-0100";
    const screen = await render(
      <ReferencePhoneActions phone={phone} referenceName="Rivka Levi" />,
    );

    await expect
      .element(screen.getByText("Check this number before calling"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /Call/i }))
      .not.toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Copy Rivka Levi, number 1" })
      .click();
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

    await screen
      .getByRole("button", { name: "Copy Rivka Levi, number 1" })
      .click();
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
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 1" }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("link", {
          name: "WhatsApp Rivka Levi, number 1",
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { name: "Copy Rivka Levi, number 1" }),
      )
      .not.toBeInTheDocument();
  });

  it("keeps every valid number actionable on a coarse pointer", async () => {
    setMatchMedia(false);
    const screen = await render(
      <ReferencePhoneActions
        phone="732-930-6891; 201-555-0100"
        referenceName="Rivka Levi"
      />,
    );

    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 1" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Call Rivka Levi, number 2" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /Copy Rivka Levi/ }))
      .not.toBeInTheDocument();
  });

  it.each([390, 1280])(
    "keeps split-number actions visible at the mockup width %dpx",
    async (width) => {
      await page.viewport(width, 844);
      const screen = await render(
        <ReferencePhoneActions
          phone="732-930-6891; 201-555-0100"
          referenceName="Rivka Levi"
        />,
      );

      await expect
        .element(
          screen.getByRole("link", { name: "Call Rivka Levi, number 1" }),
        )
        .toBeVisible();
      await expect
        .element(
          screen.getByRole("link", { name: "Call Rivka Levi, number 2" }),
        )
        .toBeVisible();
      expect(screen.container.querySelectorAll('a[href^="tel:"]').length).toBe(
        2,
      );
    },
  );

  it("restores focus to the last WhatsApp trigger for number 2", async () => {
    const referenceLink = { id: "link-1" } as ReferenceLinkSummary;
    const props = {
      phone: "732-930-6891; 201-555-0100",
      referenceName: "Rivka Levi",
      referenceLink,
    };
    const screen = await render(<ReferencePhoneActions {...props} />);

    await screen
      .getByRole("link", { name: "WhatsApp Rivka Levi, number 2" })
      .click();
    expect(returnFlow.arm).toHaveBeenCalledTimes(1);

    returnFlow.isPromptOpen = true;
    await screen.rerender(<ReferencePhoneActions {...props} />);
    await screen.getByRole("button", { name: "Close return sheet" }).click();

    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("WhatsApp Rivka Levi, number 2");
  });
});

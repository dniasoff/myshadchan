import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import MobileHeader from "./MobileHeader";

/**
 * `MobileContent` reserves its top clearance from `--mobile-header-active`,
 * which only this component publishes — so the variable IS the contract
 * between them. Only 3 of the ~10 mobile routes render a header; the other
 * routes used to open with 72px of blank space above their first element
 * because the clearance was unconditional.
 */
const readHeaderVar = () =>
  document.documentElement.style.getPropertyValue("--mobile-header-active");

describe("MobileHeader — the clearance it publishes", () => {
  it("publishes the header height while it is mounted", async () => {
    // Arrange / Act
    await render(<MobileHeader>Dashboard</MobileHeader>);

    // Assert — the token, not a literal, so a resize in index.css moves both
    // the bar and the clearance together.
    expect(readHeaderVar()).toBe("var(--mobile-header-h)");
  });

  it("drops the clearance again when the route that owned it unmounts", async () => {
    // Arrange
    const screen = await render(<MobileHeader>Dashboard</MobileHeader>);
    expect(readHeaderVar()).toBe("var(--mobile-header-h)");

    // Act
    screen.unmount();

    // Assert — removed rather than zeroed, so `MobileContent`'s own
    // `var(--mobile-header-active,0px)` fallback is what answers.
    expect(readHeaderVar()).toBe("");
  });
});

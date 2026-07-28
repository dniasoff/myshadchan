import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { RaRecord } from "ra-core";

import { DefaultIdentityHeader } from "./DefaultIdentityHeader";

/**
 * `EntityShow`'s fallback identity composition (Epic 3 API contract §2 —
 * "used ONLY when `identityHeader` is absent"). Every field is
 * independently optional; the all-absent case is AC 9's proof that a
 * minimal descriptor does not throw.
 */

const record: RaRecord = { id: 42 };

describe("DefaultIdentityHeader", () => {
  it("renders the resolved title and a joined, filtered meta line", async () => {
    // Arrange / Act
    const screen = await render(
      <DefaultIdentityHeader
        record={record}
        title={() => "Ari Rosenberg"}
        meta={() => ["Brooklyn", null, undefined, "Age 24"]}
      />,
    );

    // Assert
    await expect.element(screen.getByText("Ari Rosenberg")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Brooklyn · Age 24"))
      .toBeInTheDocument();
  });

  it("feeds the avatar's seed from `avatar`, independent of title/meta", async () => {
    // Arrange / Act
    const screen = await render(
      <DefaultIdentityHeader
        record={record}
        avatar={() => ({ seed: "a-stable-seed" })}
        title={() => "Ari Rosenberg"}
      />,
    );

    // Assert — the chip (the sole `aria-hidden` element) renders a
    // monogram derived from the title. Scoped to the chip itself, rather
    // than a bare text query, because "Ari Rosenberg" also case-insensitive
    // substring-matches "AR" (its own leading "Ar").
    const chip = screen.container.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    expect(chip.textContent).toBe("AR");
  });

  it("renders an unlabelled avatar chip and no text when every field is absent", async () => {
    // Arrange / Act
    const screen = await render(<DefaultIdentityHeader record={record} />);

    // Assert — does not throw, and degrades to just the "?" monogram chip.
    await expect.element(screen.getByText("?")).toBeInTheDocument();
    expect(screen.container.querySelector("h1")).toBeNull();
    expect(screen.container.querySelector("p")).toBeNull();
  });
});

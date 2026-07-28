import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { RaRecord } from "ra-core";

// The `--avatar-{0..9}` custom properties the seed-colour assertion below
// relies on are only defined here — real Chromium computes real CSS, same
// precedent as `EntityAvatar.test.tsx`.
import "@/index.css";

import { getAvatarIndex } from "./avatar";
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
    // Arrange — `seed`'s only observable effect is the chip's computed
    // `background-color` (`var(--avatar-{getAvatarIndex(seed)})`,
    // `EntityAvatar.tsx`); the monogram comes from `title`, not `seed`. A
    // probe styled with the same CSS variable expression, per
    // `EntityAvatar.test.tsx`'s own precedent, is what makes this
    // assertion falsifiable — asserting only the monogram text would pass
    // even if the seed computation were replaced with `null` (review
    // finding 4, Epic 3 step 5 adversarial review).
    const seed = "a-stable-seed";
    const expectedIndex = getAvatarIndex(seed);
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(--avatar-${expectedIndex})`;
    document.body.appendChild(probe);

    // Act
    const screen = await render(
      <DefaultIdentityHeader
        record={record}
        avatar={() => ({ seed })}
        title={() => "Ari Rosenberg"}
      />,
    );

    // Assert — the chip (the sole `aria-hidden` element) renders a
    // monogram derived from the title (scoped to the chip itself, rather
    // than a bare text query, because "Ari Rosenberg" also
    // case-insensitive substring-matches "AR", its own leading "Ar") AND a
    // computed background colour matching `getAvatarIndex(seed)`.
    const chip = screen.container.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    expect(chip.textContent).toBe("AR");
    expect(getComputedStyle(chip).backgroundColor).toBe(
      getComputedStyle(probe).backgroundColor,
    );

    document.body.removeChild(probe);
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

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

// The `--avatar-{0..9}` custom properties this component's colour tests rely
// on are only defined here — real Chromium computes real CSS, so the real
// stylesheet is what makes those assertions mean anything.
import "@/index.css";

import { getAvatarIndex } from "./avatar";
import { EntityAvatar } from "./EntityAvatar";

/**
 * Per-variant className coverage (AC 5's rewire table): each of the four
 * live header chips must keep rendering at its existing size/radius/text
 * scale once it goes through `EntityAvatar`.
 */
describe("EntityAvatar — per-header className variants", () => {
  it("renders the single header's size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <EntityAvatar
        seed="Ari Rosenberg"
        monogramSource="Ari Rosenberg"
        className="h-14 w-14 rounded-2xl text-xl"
      />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    for (const token of ["h-14", "w-14", "rounded-2xl", "text-xl"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.textContent).toBe("AR");
  });

  it("renders the shadchan header's size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <EntityAvatar
        seed="Devorah Klein"
        monogramSource="Devorah Klein"
        className="h-14 w-14 rounded-2xl text-lg"
      />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    for (const token of ["h-14", "w-14", "rounded-2xl", "text-lg"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the reference header's size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <EntityAvatar
        seed="Moshe Fried"
        monogramSource="Moshe Fried"
        className="h-12 w-12 rounded-xl text-base"
      />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    for (const token of ["h-12", "w-12", "rounded-xl", "text-base"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the shidduch header's size/radius/text classes and aria-hidden", async () => {
    // Arrange / Act
    const screen = await render(
      <EntityAvatar
        seed="Shira Katz"
        monogramSource="Shira Katz"
        className="size-14 rounded-2xl text-lg"
      />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    for (const token of ["size-14", "rounded-2xl", "text-lg"]) {
      expect(chip.className).toContain(token);
    }
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to the default size/radius/text classes when className is omitted", async () => {
    // Arrange / Act
    const screen = await render(
      <EntityAvatar seed="Ari Rosenberg" monogramSource="Ari Rosenberg" />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    for (const token of ["h-14", "w-14", "rounded-2xl", "text-lg"]) {
      expect(chip.className).toContain(token);
    }
  });
});

describe("EntityAvatar — monogram and seed are independent inputs", () => {
  it("derives the monogram from monogramSource, not from seed", async () => {
    // Arrange / Act — a record with no name (monogramSource undefined) but a
    // stable id-derived palette seed, mirroring every real call site.
    const screen = await render(
      <EntityAvatar seed="42" monogramSource={undefined} />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    expect(chip.textContent).toBe("?");
  });
});

describe("EntityAvatar — deterministic, distinct avatar colours (AC 4)", () => {
  it("renders different computed background colours for two seeds whose palette index differs", async () => {
    // Arrange
    const seedA = "Ari Rosenberg";
    const seedB = "Boruch Stern";
    expect(getAvatarIndex(seedA)).not.toBe(getAvatarIndex(seedB));

    // Act
    const screenA = await render(
      <EntityAvatar seed={seedA} monogramSource={seedA} />,
    );
    const screenB = await render(
      <EntityAvatar seed={seedB} monogramSource={seedB} />,
    );
    const chipA = screenA.container.children[0] as HTMLElement;
    const chipB = screenB.container.children[0] as HTMLElement;

    // Assert
    expect(getComputedStyle(chipA).backgroundColor).not.toBe(
      getComputedStyle(chipB).backgroundColor,
    );
  });

  it("matches the computed background colour of a probe styled with the same --avatar-{n} variable", async () => {
    // Arrange
    const seed = "Ari Rosenberg";
    const index = getAvatarIndex(seed);
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(--avatar-${index})`;
    document.body.appendChild(probe);

    // Act
    const screen = await render(
      <EntityAvatar seed={seed} monogramSource={seed} />,
    );
    const chip = screen.container.children[0] as HTMLElement;

    // Assert
    expect(getComputedStyle(chip).backgroundColor).toBe(
      getComputedStyle(probe).backgroundColor,
    );

    document.body.removeChild(probe);
  });
});

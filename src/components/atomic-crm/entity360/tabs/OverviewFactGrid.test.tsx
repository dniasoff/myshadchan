import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { OverviewFactGrid, type OverviewFact } from "./OverviewFactGrid";

const EMPTY_LABEL = "No details on file yet.";

describe("OverviewFactGrid", () => {
  it("renders exactly the facts that carry a value, omitting value-less ones", async () => {
    // Arrange
    const facts: OverviewFact[] = [
      { label: "Parents", en: "Mr & Mrs Cohen" },
      { label: "Seminary" }, // no en/he/plain — must render nothing
      { label: "Shul", en: "Beis Medrash" },
    ];

    // Act
    const screen = await render(
      <OverviewFactGrid facts={facts} emptyLabel={EMPTY_LABEL} />,
    );

    // Assert
    expect(screen.container.querySelectorAll("dt").length).toBe(2);
  });

  it("renders a Hebrew-only fact's value with dir=rtl and the font-hebrew class", async () => {
    // Arrange
    const facts: OverviewFact[] = [{ label: "Shul", he: "בית מדרש" }];

    // Act
    const screen = await render(
      <OverviewFactGrid facts={facts} emptyLabel={EMPTY_LABEL} />,
    );

    // Assert
    const heValue = screen.container.querySelector("dd span[dir='rtl']");
    expect(heValue).not.toBeNull();
    expect(heValue?.className).toContain("font-hebrew");
    expect(heValue?.textContent).toBe("בית מדרש");
  });

  it("renders emptyLabel and no <dl> when every fact is value-less", async () => {
    // Arrange
    const facts: OverviewFact[] = [{ label: "Parents" }, { label: "Shul" }];

    // Act
    const screen = await render(
      <OverviewFactGrid facts={facts} emptyLabel={EMPTY_LABEL} />,
    );

    // Assert
    await expect.element(screen.getByText(EMPTY_LABEL)).toBeInTheDocument();
    expect(screen.container.querySelector("dl")).toBeNull();
  });
});

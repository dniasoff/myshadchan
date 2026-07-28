import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import type { OverviewFact } from "./OverviewFactGrid";
import { OverviewTab } from "./OverviewTab";

const renderTab = (
  facts: OverviewFact[],
  children?: ReactNode,
  emptyLabel?: string,
) =>
  render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <OverviewTab facts={facts} emptyLabel={emptyLabel}>
        {children}
      </OverviewTab>
    </CoreAdminContext>,
  );

describe("OverviewTab", () => {
  it("renders the fact grid followed by children when facts are present", async () => {
    // Arrange
    const facts: OverviewFact[] = [{ label: "Parents", en: "Mr & Mrs Cohen" }];

    // Act
    const screen = await renderTab(facts, <div>Custom section</div>);

    // Assert
    await expect
      .element(screen.getByText("Mr & Mrs Cohen"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Custom section"))
      .toBeInTheDocument();
  });

  it("shows the default translated empty label when every fact is value-less", async () => {
    // Arrange
    const facts: OverviewFact[] = [{ label: "Parents" }];

    // Act
    const screen = await renderTab(facts);

    // Assert — resolved through the i18nProvider (crm.entity360.overview.empty)
    await expect
      .element(screen.getByText("No details on file yet."))
      .toBeInTheDocument();
  });

  it("renders children and suppresses the empty label for an empty facts array (AC 5)", async () => {
    // Arrange / Act — an entity whose Overview is entirely custom sections
    const screen = await renderTab([], <div>Fully custom overview</div>);

    // Assert
    await expect
      .element(screen.getByText("Fully custom overview"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("No details on file yet."))
      .not.toBeInTheDocument();
  });
});

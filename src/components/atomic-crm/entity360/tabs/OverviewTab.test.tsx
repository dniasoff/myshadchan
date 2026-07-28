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

  it("shows the empty label when every fact is value-less and no children are given (regression)", async () => {
    // Arrange — a facts array that is non-empty but carries no value, no children
    const facts: OverviewFact[] = [{ label: "Parents" }];

    // Act
    const screen = await renderTab(facts);

    // Assert — the tab must never render blank with no UX-DR11 empty state
    await expect
      .element(screen.getByText("No details on file yet."))
      .toBeInTheDocument();
  });

  it("suppresses the empty label above children when every fact is value-less but children are given (regression)", async () => {
    // Arrange — a value-less facts array alongside real custom content
    const facts: OverviewFact[] = [{ label: "Parents" }];

    // Act
    const screen = await renderTab(facts, <div>Custom section</div>);

    // Assert — the generic empty copy must not shadow real content
    await expect
      .element(screen.getByText("Custom section"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("No details on file yet."))
      .not.toBeInTheDocument();
  });
});

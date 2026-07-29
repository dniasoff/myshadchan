import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityDescriptor } from "./entityDescriptor";
import { RecordUnavailable } from "./RecordUnavailable";
import { registerEntityDescriptor } from "./registry";

/**
 * `RecordUnavailable` is the screen a stale or cross-context deep link
 * lands on, so its one link is the last thing standing between a bad URL
 * and whatever surface it offers. For a no-browse entity (RULING 7) that
 * used to be "back to the list" — an invitation to browse, handed out on
 * the exact screen a user reaches by accident.
 */

const registerFixture = (
  name: string,
  overrides: Partial<EntityDescriptor> = {},
): void => {
  registerEntityDescriptor(
    {
      name,
      label: name,
      buildRecordPath: (id) => `/${name}/${id}`,
      ...overrides,
    },
    { replace: true },
  );
};

const renderFor = async (resource: string) =>
  render(
    <TestMemoryRouter initialEntries={[`/${resource}/9999`]}>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={resource}>
          <RecordUnavailable />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("RecordUnavailable — the way out respects the entity's browsability", () => {
  it("offers the list for a browsable entity", async () => {
    // Arrange
    registerFixture("record-unavailable-browsable-fixture");

    // Act
    const screen = await renderFor("record-unavailable-browsable-fixture");

    // Assert
    await expect
      .element(screen.getByRole("link", { name: "Back to the list" }))
      .toHaveAttribute("href", "/record-unavailable-browsable-fixture");
  });

  it("offers the dashboard for an entity with no browse surface", async () => {
    // Arrange — RULING 7's shape.
    registerFixture("record-unavailable-no-browse-fixture", {
      browsable: false,
    });

    // Act
    const screen = await renderFor("record-unavailable-no-browse-fixture");

    // Assert — neither the label nor the href may name the closed surface.
    await expect
      .element(screen.getByRole("link", { name: "Back to the dashboard" }))
      .toHaveAttribute("href", "/");
    await expect
      .element(screen.getByRole("link", { name: "Back to the list" }))
      .not.toBeInTheDocument();
  });
});

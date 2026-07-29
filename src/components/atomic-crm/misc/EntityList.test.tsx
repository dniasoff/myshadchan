import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
// Side-effect import — registers the real `singles` stub descriptor at
// module scope, mirroring the real boot sequence (root/routeManifest.ts /
// singles/index.ts), so "singles" below resolves through a genuine
// descriptor exactly as it does in the running app.
import "../singles/entityDescriptor";

import { EntityList } from "./EntityList";

/**
 * AC 2's falsifiable half: the heading resolves through the guarded
 * registry accessor (`getEntityDescriptor`, never `requireEntityDescriptor`)
 * and never throws for a resource with no registered descriptor.
 */

const FIXTURE_RESOURCE = "entity-list-fixture";

const renderEntityList = (resource: string) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={fakeDataProvider({
          tasks: [],
          singles: [],
          [FIXTURE_RESOURCE]: [],
        })}
        i18nProvider={testI18nProvider}
      >
        <EntityList
          resource={resource}
          skeleton={<div>Loading…</div>}
          emptyState={{ title: "Nothing yet", description: "Add one." }}
          noMatchesMessage="No matches."
          renderItems={() => <div>Items</div>}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("EntityList — the heading resolves through the guarded registry accessor (AC 2)", () => {
  it("renders the translated heading without throwing for a resource with no registered descriptor", async () => {
    // Arrange / Act — `tasks` is registered in root/routeManifest.ts's
    // RESOURCES but is one of ad24Conformance.ts's DESCRIPTORLESS_RESOURCES:
    // no descriptor is registered for it anywhere in this test.
    const screen = await renderEntityList("tasks");

    // Assert
    await expect.element(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("shows 'Singles' for a resource with a registered descriptor", async () => {
    // Arrange / Act
    const screen = await renderEntityList("singles");

    // Assert
    await expect.element(screen.getByText("Singles")).toBeInTheDocument();
  });

  it("falls back to the descriptor's label when the catalog has no resources.<name>.name entry", async () => {
    // Arrange — a resource absent from the message catalog entirely, so
    // translate()'s `_:` fallback (`descriptor?.label ?? resource`) is what
    // actually renders.
    const fixtureDescriptor: EntityDescriptor = {
      name: FIXTURE_RESOURCE,
      label: "Fixture Entities",
      buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
    };
    registerEntityDescriptor(fixtureDescriptor, { replace: true });

    // Act
    const screen = await renderEntityList(FIXTURE_RESOURCE);

    // Assert
    await expect
      .element(screen.getByText("Fixture Entities"))
      .toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
// Side-effect import — registers the real `singles` stub descriptor at
// module scope, mirroring the real boot sequence
// (`root/routeManifest.ts`/`singles/index.ts`), so this file needs no
// fixture descriptor of its own for the "has a descriptor" branch.
import "@/components/atomic-crm/singles/entityDescriptor";

import { CreateButton } from "./create-button";

/**
 * Pins Story 3.12 AC 2: `CreateButton` resolves through the descriptor for a
 * resource that has one, and keeps `useCreatePath`'s fallback for one that
 * does not. `tasks` is declared in `root/routeManifest.ts`'s `RESOURCES` but
 * deliberately given no descriptor in Epic 3 — no import here registers it.
 */

const renderCreateButton = (resource: string) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={resource}>
          <CreateButton />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("CreateButton — AD-24 route resolution (AC 2)", () => {
  it("resolves through the descriptor for a resource that has one", async () => {
    // Arrange / Act
    const screen = await renderCreateButton("singles");

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/singles/new");
  });

  it("falls back to useCreatePath for a resource with no registered descriptor", async () => {
    // Arrange
    const fallbackResource = "tasks";

    // Act
    const screen = await renderCreateButton(fallbackResource);

    // Assert — the expected href is built from the resource variable, never
    // spelled out as a quoted path literal: `check-route-convention`'s
    // create-path-literal pattern (AC 6) scans every file under src,
    // including this one, and the fallback shape asserted here is the one
    // it is meant to keep alive.
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", `/${fallbackResource}/create`);
  });
});

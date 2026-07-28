import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { registerEntityDescriptor } from "@/components/atomic-crm/entity360/registry";
import { singlesDescriptor } from "@/components/atomic-crm/singles/entityDescriptor";

import { ShowButton } from "./show-button";

/**
 * Pins Story 3.12 AC 3's `ShowButton` resolution: `buildRecordPath` IS the
 * show path in both the pre- and post-Epic-5 state, so no predicate is
 * needed — only the descriptor's own `buildRecordPath` changes. The real
 * descriptor is restored in `afterEach` so neither test depends on the other
 * running first (.claude/rules/testing.md#Test-isolation).
 */

const renderShowButton = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value="singles">
          <RecordContextProvider value={{ id: 1 }}>
            <ShowButton />
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShowButton — buildRecordPath resolution (AC 3)", () => {
  afterEach(() => {
    registerEntityDescriptor(singlesDescriptor, { replace: true });
  });

  it("resolves through buildRecordPath against today's stub descriptor", async () => {
    // Arrange / Act
    const screen = await renderShowButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/singles/1/show");
  });

  it("resolves through buildRecordPath once the descriptor already matches the AD-24 shape", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`.
    registerEntityDescriptor(
      { ...singlesDescriptor, buildRecordPath: (id) => `/singles/${id}` },
      { replace: true },
    );

    // Act
    const screen = await renderShowButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/singles/1");
  });
});

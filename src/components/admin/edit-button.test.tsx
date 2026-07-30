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
import { referencesDescriptor } from "@/components/atomic-crm/references/entityDescriptor";

import { EditButton } from "./edit-button";

/**
 * Pins Story 3.12 AC 3's `hasAd24RecordShape` predicate, both branches. The
 * "today" branch uses the real registered `references` stub descriptor
 * (imported above — `buildRecordPath` still `/references/{id}/show`; Story
 * 5.10 migrates it. Pinned against `references` rather than `shadchanim`/
 * `singles` — both already flipped to the AD-24 shape by Stories 5.9/5.8 —
 * this file needs an entity that still HAS a pre-migration state to pin);
 * the "Epic 5" branch replaces it with a descriptor whose `buildRecordPath`
 * already matches the AD-24 shape. The real descriptor is restored in
 * `afterEach` so neither test depends on the other running first
 * (.claude/rules/testing.md#Test-isolation).
 */

const renderEditButton = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value="references">
          <RecordContextProvider value={{ id: 1 }}>
            <EditButton />
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("EditButton — hasAd24RecordShape predicate (AC 3)", () => {
  afterEach(() => {
    registerEntityDescriptor(referencesDescriptor, { replace: true });
  });

  it("falls back to useCreatePath's live edit route against today's stub descriptor", async () => {
    // Arrange / Act
    const screen = await renderEditButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/references/1");
  });

  it("resolves through buildEditPath once the descriptor already matches the AD-24 shape", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`.
    registerEntityDescriptor(
      { ...referencesDescriptor, buildRecordPath: (id) => `/references/${id}` },
      { replace: true },
    );

    // Act
    const screen = await renderEditButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", "/references/1/edit");
  });
});

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import type { EntityDescriptor } from "@/components/atomic-crm/entity360/entityDescriptor";
import { registerEntityDescriptor } from "@/components/atomic-crm/entity360/registry";

import { EditButton } from "./edit-button";

/**
 * Pins Story 3.12 AC 3's `hasAd24RecordShape` predicate, both branches.
 * Story 5.10 migrated `references` — the last of the four AD-24 entities
 * (`shidduchim` 5.1, `singles` 5.8, `shadchanim` 5.9, `references` 5.10) —
 * onto the bare AD-24 path, so there is no longer a REAL resource with a
 * pre-migration `buildRecordPath` left to pin the "today" branch against
 * (the gap this file's own Dev Notes flagged when Story 5.9 repointed it
 * here from `shadchanim`, and Story 5.10's own Dev Notes flagged again).
 * A synthetic fixture resource — registered only for this test, never a
 * real `<Resource>` — replaces it: the predicate itself only reads
 * `buildRecordPath`'s shape, not whether the resource is real. Each test
 * registers its own descriptor state, so neither depends on the other
 * running first (.claude/rules/testing.md#Test-isolation) and no
 * `afterEach` restore is needed.
 */

const FIXTURE_RESOURCE = "ad24EditButtonFixture";

const registerFixtureDescriptor = (
  buildRecordPath: EntityDescriptor["buildRecordPath"],
): void => {
  registerEntityDescriptor(
    { name: FIXTURE_RESOURCE, label: "Fixture", buildRecordPath },
    { replace: true },
  );
};

const renderEditButton = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RecordContextProvider value={{ id: 1 }}>
            <EditButton />
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("EditButton — hasAd24RecordShape predicate (AC 3)", () => {
  it("falls back to useCreatePath's live edit route for a pre-migration buildRecordPath shape", async () => {
    // Arrange — today's real stub shape before an entity migrates.
    registerFixtureDescriptor((id) => `/${FIXTURE_RESOURCE}/${id}/show`);

    // Act
    const screen = await renderEditButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", `/${FIXTURE_RESOURCE}/1`);
  });

  it("resolves through buildEditPath once the descriptor already matches the AD-24 shape", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`.
    registerFixtureDescriptor((id) => `/${FIXTURE_RESOURCE}/${id}`);

    // Act
    const screen = await renderEditButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", `/${FIXTURE_RESOURCE}/1/edit`);
  });
});

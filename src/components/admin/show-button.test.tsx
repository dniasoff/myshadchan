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

import { ShowButton } from "./show-button";

/**
 * Pins Story 3.12 AC 3's `ShowButton` resolution: `buildRecordPath` IS the
 * show path in both the pre- and post-Epic-5 state, so no predicate is
 * needed — only the descriptor's own `buildRecordPath` changes. Story 5.10
 * migrated `references` — the last of the four AD-24 entities — onto the
 * bare AD-24 path, so there is no longer a REAL resource with a
 * pre-migration `buildRecordPath` left to pin against (this file's own Dev
 * Notes flagged the gap when Story 5.9 repointed it here from
 * `shadchanim`, and Story 5.10's own Dev Notes flagged it again). A
 * synthetic fixture resource — registered only for this test, never a real
 * `<Resource>` — replaces it: `ShowButton` only reads `buildRecordPath`'s
 * shape, not whether the resource is real. Each test registers its own
 * descriptor state, so neither depends on the other running first
 * (.claude/rules/testing.md#Test-isolation) and no `afterEach` restore is
 * needed.
 */

const FIXTURE_RESOURCE = "ad24ShowButtonFixture";

const registerFixtureDescriptor = (
  buildRecordPath: EntityDescriptor["buildRecordPath"],
): void => {
  registerEntityDescriptor(
    { name: FIXTURE_RESOURCE, label: "Fixture", buildRecordPath },
    { replace: true },
  );
};

const renderShowButton = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RecordContextProvider value={{ id: 1 }}>
            <ShowButton />
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShowButton — buildRecordPath resolution (AC 3)", () => {
  it("resolves through buildRecordPath against a pre-migration stub shape", async () => {
    // Arrange — today's real stub shape before an entity migrates.
    registerFixtureDescriptor((id) => `/${FIXTURE_RESOURCE}/${id}/show`);

    // Act
    const screen = await renderShowButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", `/${FIXTURE_RESOURCE}/1/show`);
  });

  it("resolves through buildRecordPath once the descriptor already matches the AD-24 shape", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`.
    registerFixtureDescriptor((id) => `/${FIXTURE_RESOURCE}/${id}`);

    // Act
    const screen = await renderShowButton();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", `/${FIXTURE_RESOURCE}/1`);
  });
});

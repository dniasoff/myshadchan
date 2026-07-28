import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider, RaRecord } from "ra-core";

// Real computed CSS is required for the avatar background-colour assertion
// below — same precedent as `EntityAvatar.test.tsx`.
import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { getAvatarIndex } from "./avatar";
import { buildEntityRoutes } from "./buildEntityRoutes";
import type { EntityDescriptor } from "./entityDescriptor";
import { EntityShow } from "./EntityShow";
import { registerEntityDescriptor } from "./registry";

/**
 * Story 3.3b AC 7 — region-composition coverage the two "entirely from the
 * declaration" fixtures in `EntityShow.test.tsx` do not reach: a
 * descriptor's own `identityHeader` component, `alertSlot`, and the
 * `avatar`/`meta` fields of the default identity composition. Each of these
 * three branches was independently removable from `EntityShow.tsx` with the
 * rest of the entity360 suite green — no existing fixture declared any of
 * them (adversarial review, Epic 3 step 5, finding 3).
 */

const FIXTURE_RESOURCE = "entity-show-regions-fixture";
const FIXTURE_RECORD = { id: 1 };

const registerFixtureDescriptor = (
  overrides: Partial<EntityDescriptor> = {},
): void => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
    ...overrides,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

const renderEntityShow = async (initialEntries: string[]) => {
  const dataProvider = {
    getOne: vi.fn().mockResolvedValue({ data: FIXTURE_RECORD }),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          {buildEntityRoutes({ List: () => null, Show: EntityShow })}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen };
};

describe("EntityShow — a descriptor's own identityHeader replaces the default composition (AC 7)", () => {
  it("renders the descriptor's identityHeader and never falls back to avatar/title/meta", async () => {
    // Arrange — `title` is set too, to a string that renders if (and only
    // if) EntityShow ignores `identityHeader` and falls through to the
    // default composition instead of using it.
    const CustomIdentityHeader: ComponentType<{ record: RaRecord }> = () => (
      <div>CUSTOM_IDENTITY_HEADER</div>
    );
    registerFixtureDescriptor({
      identityHeader: CustomIdentityHeader,
      title: () => "SHOULD_NOT_RENDER_DEFAULT_TITLE",
    });

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert
    await expect
      .element(screen.getByText("CUSTOM_IDENTITY_HEADER"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("SHOULD_NOT_RENDER_DEFAULT_TITLE"))
      .not.toBeInTheDocument();
  });
});

describe("EntityShow — alertSlot renders the descriptor's own component (AC 7)", () => {
  it("renders the alertSlot region when the descriptor declares one", async () => {
    // Arrange
    const AlertSlot: ComponentType<{ record: RaRecord }> = () => (
      <div role="alert">ALERT_CONTENT</div>
    );
    registerFixtureDescriptor({
      title: () => "Alert Fixture",
      alertSlot: AlertSlot,
    });

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert
    await expect.element(screen.getByText("ALERT_CONTENT")).toBeInTheDocument();
    expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("renders no alert region at all when the descriptor declares none", async () => {
    // Arrange
    registerFixtureDescriptor({ title: () => "No Alert Fixture" });

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert
    await expect
      .element(screen.getByText("No Alert Fixture"))
      .toBeInTheDocument();
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("EntityShow — the default identity composition threads avatar and meta through from the descriptor (AC 7)", () => {
  it("renders the descriptor's meta line and the avatar coloured by the descriptor's own seed", async () => {
    // Arrange — a seed distinct from the id/title default fallbacks a
    // deleted `avatar`/`meta` prop would silently degrade to.
    const seed = "meta-fixture-seed";
    const expectedIndex = getAvatarIndex(seed);
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(--avatar-${expectedIndex})`;
    document.body.appendChild(probe);

    registerFixtureDescriptor({
      title: () => "Meta Fixture",
      avatar: () => ({ seed }),
      meta: () => ["Meta Line One", "Meta Line Two"],
    });

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert — the meta line renders exactly as `DefaultIdentityHeader`
    // joins it, and the avatar chip's computed colour is the one the
    // descriptor's own `seed` selects.
    await expect
      .element(screen.getByText("Meta Line One · Meta Line Two"))
      .toBeInTheDocument();
    const chip = screen.container.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    expect(getComputedStyle(chip).backgroundColor).toBe(
      getComputedStyle(probe).backgroundColor,
    );

    document.body.removeChild(probe);
  });
});

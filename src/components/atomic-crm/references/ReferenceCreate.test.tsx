import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

// Side-effect import — registers the "references" entity descriptor, exactly
// as `references/index.ts` does at boot. `redirectToRecord` (the post-save
// redirect) resolves through it via `buildRecordPath`.
import "./entityDescriptor";
import { ReferenceCreate } from "./ReferenceCreate";

/**
 * Pins the fix for the live orphan-reference bug (RULING 7 clause 5 / the
 * §2 case-1 fix in references-scoping-plan.md): the sanctioned in-shidduch
 * "Add a reference" CTA must never be able to produce a `references` row
 * with zero `reference_links`.
 *
 * `ReferenceCreate` reads `?shidduchim_id=` off `window.location.search`
 * directly (not through the router), so each test drives that with
 * `window.history.pushState` rather than `TestMemoryRouter`'s
 * `initialEntries` — the two are independent here. `initialEntries` still
 * matters for the *redirect* assertions, which go through react-router's
 * memory history via `useRedirect`/`useNavigate`.
 */

const setUrl = (path: string) => {
  window.history.pushState(null, "", path);
};

afterEach(() => {
  setUrl("/");
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    // MatchOnEntry's useReferenceMatch only calls this once name AND
    // (phone|school) are filled; the tests below fill name only, so it is
    // never invoked, but it is stubbed defensively since the hook is
    // unconditionally mounted.
    matchReferenceOnEntry: vi.fn().mockResolvedValue([]),
    create: vi
      .fn()
      .mockResolvedValue({ data: { id: 100, name_en: "Chaya Cohen" } }),
    linkReferenceToShidduch: vi.fn().mockResolvedValue({ id: 1 }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderReferenceCreate = async (
  url: string,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  setUrl(url);
  const dataProvider = buildDataProvider(dataProviderOverrides);
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={[url]}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        {/* Mirrors production wiring: `references/index.ts` mounts
            `ReferenceCreate` as a child route of `<Resource name="references">`,
            which is what supplies the resource context `<Create>` (inside
            `ReferenceCreate`) needs — `ReferenceCreate` itself never passes
            an explicit `resource` prop. */}
        <ResourceContextProvider value="references">
          <ReferenceCreate />
        </ResourceContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, getPathname: () => pathname };
};

describe("ReferenceCreate — refuses creation without a resolvable shidduch (Ruling 7 clause 5)", () => {
  it("renders a refusal, not the form, when shidduchim_id is missing", async () => {
    // Arrange / Act
    const { screen, dataProvider } =
      await renderReferenceCreate("/references/new");

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect.element(screen.getByLabelText("Name")).not.toBeInTheDocument();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("renders a refusal when shidduchim_id is not a resolvable id", async () => {
    // Arrange / Act
    const { screen, dataProvider } = await renderReferenceCreate(
      "/references/new?shidduchim_id=not-a-number",
    );

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("renders a refusal for a non-positive shidduchim_id", async () => {
    // Arrange / Act
    const { screen } = await renderReferenceCreate(
      "/references/new?shidduchim_id=0",
    );

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("offers a way back to the pipeline instead of the form", async () => {
    // Arrange / Act
    const { screen } = await renderReferenceCreate("/references/new");

    // Assert
    await expect
      .element(screen.getByRole("link", { name: "Go to the pipeline" }))
      .toBeInTheDocument();
  });
});

describe("ReferenceCreate — no orphan can be produced on save (Ruling 7 / §2 case 1)", () => {
  it("links the new reference to the named shidduch and redirects to the record", async () => {
    // Arrange
    const { screen, dataProvider, getPathname } = await renderReferenceCreate(
      "/references/new?shidduchim_id=42",
    );
    await screen.getByLabelText("Name").fill("Chaya Cohen");

    // Act
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — created, then linked with the SAME id the create call
    // returned (the exact invariant that rules out a zero-link orphan).
    await expect.poll(() => getPathname()).toBe("/references/100/show");
    expect(dataProvider.create).toHaveBeenCalledTimes(1);
    expect(dataProvider.linkReferenceToShidduch).toHaveBeenCalledTimes(1);
    expect(dataProvider.linkReferenceToShidduch).toHaveBeenCalledWith({
      reference_id: 100,
      shidduchim_id: 42,
    });
  });

  it("still redirects to the record when the link call fails, and notifies the error", async () => {
    // Arrange
    const { screen, dataProvider, getPathname } = await renderReferenceCreate(
      "/references/new?shidduchim_id=42",
      {
        linkReferenceToShidduch: vi
          .fn()
          .mockRejectedValue(new Error("shidduch 42 not found")),
      },
    );
    await screen.getByLabelText("Name").fill("Chaya Cohen");

    // Act
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — the user is not stranded on a dead form: the reference was
    // created and they land on it, even though the link failed.
    await expect.poll(() => getPathname()).toBe("/references/100/show");
    expect(dataProvider.linkReferenceToShidduch).toHaveBeenCalledTimes(1);
    await expect
      .element(screen.getByText("shidduch 42 not found"))
      .toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { AuthProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot. `buildNewPath("shidduchim")` (the
// match this component uses to decide page-vs-board) resolves through it.
import "./entityDescriptor";
import ShidduchimList from "./ShidduchimList";

/**
 * Pins Story 3.13 AC 1: mounting the real `ShidduchimList` at
 * `/shidduchim/new` renders the create page in place of the board — the
 * early return sits above `<List>` (`ShidduchimList.tsx:50-52`), so neither
 * the board nor `ShidduchimLayout`'s own `isPending` gate sits in front of
 * the page, and the board's own heading never mounts.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    getIdentity: vi.fn().mockResolvedValue({ id: 1, fullName: "Test User" }),
  }) as unknown as AuthProvider;

const buildDataProvider = (): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string) => {
      if (resource === "singles") {
        return Promise.resolve({
          data: [{ id: 1, first_name_en: "Chaya", status: "active" }],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    createShidduch: vi.fn(),
  }) as unknown as CrmDataProvider;

const renderShidduchimList = async (initialEntries: string[]) =>
  render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={buildDataProvider()}
        authProvider={buildAuthProvider()}
        i18nProvider={testI18nProvider}
      >
        <ShidduchimList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShidduchimList — the create page sits above <List> (AC 1)", () => {
  it("renders the create heading and never the board heading at /shidduchim/new", async () => {
    // Arrange / Act
    const screen = await renderShidduchimList(["/shidduchim/new"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Add a suggestion" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: /^Pipeline/ }))
      .not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `connections` descriptor so
// ConnectionCard/ConnectionRow's RecordLink resolves a real href instead of
// degrading to a plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ConnectionList } from "./ConnectionList";

const CONNECTIONS = [
  {
    id: 1,
    household_account_name: "Klein Family",
    status: "accepted",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    household_account_name: "Feldman Family",
    status: "ended",
    created_at: "2026-01-02T00:00:00Z",
  },
];

/** Fresh store per render, same isolation reasoning as `ShadchanList.test.tsx`. */
const renderConnectionList = (
  store: Store = memoryStore(),
  connections: unknown[] = CONNECTIONS,
) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        dataProvider={fakeDataProvider({ connections })}
        i18nProvider={testI18nProvider}
      >
        <ConnectionList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ConnectionList — built on EntityList (Story 8.5, AC-1)", () => {
  it("shows every connection, then only the matching one once a search term is typed", async () => {
    // Arrange
    const screen = await renderConnectionList();
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Feldman Family"))
      .toBeInTheDocument();

    // Act
    await screen.getByPlaceholder("Search by family name").fill("Klein");

    // Assert
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Feldman Family"))
      .not.toBeInTheDocument();
  });

  it("renders the calm empty state with zero connections — no ad-hoc 'add a connection' CTA", async () => {
    // Arrange / Act
    const screen = await renderConnectionList(memoryStore(), []);

    // Assert
    await expect
      .element(screen.getByText("No connections yet"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /^Add /i }))
      .not.toBeInTheDocument();
  });

  it("never shows an 'Add filter' control — ConnectionList has no extraFilters", async () => {
    // Arrange
    const screen = await renderConnectionList();
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Add filter" }))
      .not.toBeInTheDocument();
  });

  it("defaults to Cards mode on a fresh visit, never List", async () => {
    // Arrange / Act
    const screen = await renderConnectionList();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("switching to List mode swaps in ConnectionRow's markup, not the same card grid", async () => {
    // Arrange
    const screen = await renderConnectionList();
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();
    expect(screen.container.querySelector(".grid.grid-cols-1")).not.toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).toBeNull();

    // Act
    await screen.getByRole("button", { name: "List view" }).click();
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");

    // Assert
    expect(screen.container.querySelector(".grid.grid-cols-1")).toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).not.toBeNull();
    await expect.element(screen.getByText("Klein Family")).toBeInTheDocument();
  });

  it("links each row to the connection's own AD-24 record route via RecordLink, never an ad-hoc <Link>", async () => {
    // Arrange / Act
    const screen = await renderConnectionList();

    // Assert
    const link = screen.getByRole("link", { name: /Klein Family/ });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe("/connections/1");
  });

  it("shows an Accepted badge for an accepted connection and an Ended badge for an ended one", async () => {
    // Arrange / Act
    const screen = await renderConnectionList();

    // Assert
    await expect
      .element(screen.getByText("Accepted", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Ended", { exact: true }))
      .toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_PERSONAS_QUERY_KEY } from "../root/useMyPersonas";
import type { MyPersona } from "../types";
import { PersonasSection } from "./PersonasSection";

/**
 * Pins 2.5 AC-1 (commit-on-change, pre-checked from useMyPersonas()) and
 * AC-5 (both removal guards surface a specific, translated error and leave
 * the checkbox in its pre-toggle state rather than a generic toast or raw
 * Postgres text).
 */

const parentPersona: MyPersona = {
  persona: "parent",
  account_id: 1,
  account_kind: "household",
  role: "parent_admin",
};

const singlePersona: MyPersona = {
  persona: "single",
  account_id: 1,
  account_kind: "household",
  role: "parent_admin",
};

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyPersonas: vi.fn().mockResolvedValue([]),
    addPersona: vi.fn().mockResolvedValue(undefined),
    removePersona: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderSection = async (
  personas: MyPersona[],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_PERSONAS_QUERY_KEY, personas);
  const dataProvider = buildDataProvider({
    getMyPersonas: vi.fn().mockResolvedValue(personas),
    ...dataProviderOverrides,
  });

  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      queryClient={queryClient}
      i18nProvider={testI18nProvider}
    >
      <PersonasSection />
      <Notification />
    </CoreAdminContext>,
  );

  return { screen, queryClient, dataProvider };
};

describe("PersonasSection", () => {
  it("pre-checks the checklist from useMyPersonas()", async () => {
    // Arrange / Act
    const { screen } = await renderSection([parentPersona]);

    // Assert
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for my children",
        }),
      )
      .toBeChecked();
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for myself",
        }),
      )
      .not.toBeChecked();
  });

  it("ticking an unchecked box calls addPersona immediately and refreshes the checklist", async () => {
    // Arrange
    const addPersona = vi.fn().mockResolvedValue(undefined);
    const { screen, dataProvider } = await renderSection([parentPersona], {
      addPersona,
    });
    vi.mocked(dataProvider.getMyPersonas).mockResolvedValue([
      parentPersona,
      singlePersona,
    ]);

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for myself",
      })
      .click();

    // Assert
    expect(addPersona).toHaveBeenCalledExactlyOnceWith("single");
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for myself",
        }),
      )
      .toBeChecked();
  });

  it("unticking a box calls removePersona immediately and refreshes the checklist", async () => {
    // Arrange
    const removePersona = vi.fn().mockResolvedValue(undefined);
    const { screen, dataProvider } = await renderSection(
      [parentPersona, singlePersona],
      { removePersona },
    );
    vi.mocked(dataProvider.getMyPersonas).mockResolvedValue([parentPersona]);

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for myself",
      })
      .click();

    // Assert
    expect(removePersona).toHaveBeenCalledExactlyOnceWith("single");
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for myself",
        }),
      )
      .not.toBeChecked();
  });

  it("surfaces the 'only persona' guard as a specific, translated error and leaves the checkbox checked", async () => {
    // Arrange — single is the caller's only persona.
    const removePersona = vi
      .fn()
      .mockRejectedValue(new Error("cannot remove your only persona"));
    const { screen } = await renderSection([singlePersona], {
      removePersona,
    });

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for myself",
      })
      .click();

    // Assert — the specific translated copy, never a generic toast or raw
    // Postgres text.
    await expect
      .element(
        screen.getByText(
          "You can't remove your only persona. Add another first.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for myself",
        }),
      )
      .toBeChecked();
  });

  it("surfaces the 'ask your household admin' guard as a specific, translated error", async () => {
    // Arrange
    const removePersona = vi
      .fn()
      .mockRejectedValue(new Error("ask your household admin"));
    const { screen } = await renderSection([parentPersona, singlePersona], {
      removePersona,
    });

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for myself",
      })
      .click();

    // Assert
    await expect
      .element(
        screen.getByText(
          "This record is managed by your household admin — ask them to make this change.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for myself",
        }),
      )
      .toBeChecked();
  });

  it("surfaces the parent-guard error with the specific translated copy", async () => {
    // Arrange
    const removePersona = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "cannot remove parent — no other admin manages this household's other singles",
        ),
      );
    const { screen } = await renderSection([parentPersona], {
      removePersona,
    });

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for my children",
      })
      .click();

    // Assert
    await expect
      .element(
        screen.getByText(
          "Another admin needs to manage your household's other singles before you can remove this.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("checkbox", {
          name: "I'm looking for a shidduch for my children",
        }),
      )
      .toBeChecked();
  });
});

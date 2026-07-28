import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
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
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={["/settings"]}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <PersonasSection />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, queryClient, dataProvider, getPathname: () => pathname };
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

  it("removing `single` never navigates away — archiving a singles row can never touch the active context", async () => {
    // Arrange — review finding #5: `single` removal only ever archives a
    // `singles` row, never `account_members`, so it can never move or NULL
    // the active context and a scoped invalidation (already covered above)
    // stays correct — no full invalidateQueries()/navigate("/") needed.
    const removePersona = vi.fn().mockResolvedValue(undefined);
    const { screen, getPathname } = await renderSection(
      [parentPersona, singlePersona],
      { removePersona },
    );

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for myself",
      })
      .click();

    // Assert
    await expect.poll(() => removePersona).toHaveBeenCalledTimes(1);
    expect(getPathname()).toBe("/settings");
  });

  it("removing `parent` invalidates every query and navigates home, matching ContextSwitcher's handler for the same event", async () => {
    // Arrange — review finding #5: removing `shadchan`/`parent` can archive
    // the membership backing the caller's active context (AC-7), which is
    // the scope of every other cached query, not just my_personas().
    const removePersona = vi.fn().mockResolvedValue(undefined);
    const { screen, queryClient, getPathname } = await renderSection(
      [parentPersona, singlePersona],
      { removePersona },
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    // Act
    await screen
      .getByRole("checkbox", {
        name: "I'm looking for a shidduch for my children",
      })
      .click();

    // Assert
    await expect.poll(() => getPathname()).toBe("/");
    expect(invalidateQueries).toHaveBeenCalledWith(); // no scoped queryKey
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

  it("surfaces the 'last active membership' orphan guard as a specific, translated error and leaves the checkbox checked", async () => {
    // Arrange — review finding #1: removing the account's last active
    // membership while it still holds domain data is refused.
    const removePersona = vi
      .fn()
      .mockRejectedValue(
        new Error("cannot remove your last active membership of this account"),
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

    // Assert — the specific translated copy, never a generic toast or raw
    // Postgres text.
    await expect
      .element(
        screen.getByText(
          "You're the only one who can still reach this account's records — add another member before removing this.",
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

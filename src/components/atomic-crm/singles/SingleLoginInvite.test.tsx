import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext, Single } from "../types";
import { SingleLoginInvite } from "./SingleLoginInvite";

/**
 * Story 6.1 (AC 1): `SingleLoginInvite`'s own falsifiable claims — it
 * renders the invite action only for an owning role (`parent_admin`/
 * `self_manager`) on an UNLINKED single, renders nothing at all for any
 * other resolved role (including `single`/`helper`) and while the role is
 * still resolving (the fail-closed `isPending` idiom
 * `shidduchim/SingleInputForm.tsx` also uses), renders the read-only "has
 * their own login" indicator once `member_id` is set (for an owning role —
 * never a substitute for the database guards), and calls
 * `dataProvider.createInvite(email, "single", single.id)` on submit.
 */

const buildSingle = (overrides: Partial<Single> = {}): Single =>
  ({
    id: 7,
    account_id: 1,
    first_name_en: "Chana",
    last_name_en: "Klein",
    status: "active",
    member_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Single;

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const renderInvite = async (
  role: MemberRole | undefined,
  single: Single,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const contexts = role ? [contextFor(role)] : [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
    createInvite: vi.fn(),
    ...dataProviderOverrides,
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <SingleLoginInvite single={single} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("SingleLoginInvite — role/link-state gate (AC 1)", () => {
  it("renders nothing while the viewer role is still resolving", async () => {
    // Arrange — an in-flight, never-resolving query.
    const dataProvider = {
      getMyContexts: vi.fn().mockReturnValue(new Promise(() => {})),
      createInvite: vi.fn(),
    } as unknown as CrmDataProvider;
    const queryClient = new QueryClient();

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <SingleLoginInvite single={buildSingle()} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    expect(screen.container.textContent ?? "").toBe("");
  });

  it.each(["parent_admin", "self_manager"] as const)(
    "renders the invite action for a %s viewer on an unlinked single",
    async (role) => {
      // Act
      const { screen } = await renderInvite(role, buildSingle());

      // Assert
      await expect
        .element(
          screen.getByRole("button", {
            name: "Give Chana Klein their own login",
          }),
        )
        .toBeInTheDocument();
    },
  );

  it.each(["single", "helper", "shadchan"] as const)(
    "renders nothing for a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderInvite(role, buildSingle());

      // Assert
      expect(screen.container.textContent ?? "").toBe("");
    },
  );

  it("renders nothing for an unresolved role (no active membership) — fails closed", async () => {
    // Act
    const { screen } = await renderInvite(undefined, buildSingle());

    // Assert
    expect(screen.container.textContent ?? "").toBe("");
  });

  it("renders the read-only indicator, never the action button, once the single is linked", async () => {
    // Act
    const { screen } = await renderInvite(
      "parent_admin",
      buildSingle({ member_id: 42 }),
    );

    // Assert
    await expect
      .element(screen.getByText("Has their own login"))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Give Chana Klein their own login",
        }),
      )
      .not.toBeInTheDocument();
  });
});

describe("SingleLoginInvite — sending the invite (AC 1, AC 2)", () => {
  it("calls dataProvider.createInvite(email, 'single', single.id) and shows the copyable link", async () => {
    // Arrange
    const createInvite = vi.fn().mockResolvedValue({
      id: 1,
      token: "22222222-2222-2222-2222-222222222222",
    });
    const { screen } = await renderInvite("parent_admin", buildSingle(), {
      createInvite,
    });

    // Act
    await screen
      .getByRole("button", { name: "Give Chana Klein their own login" })
      .click();
    await screen.getByLabelText("Email").fill("chana@example.com");
    await screen.getByRole("button", { name: "Send invite" }).click();

    // Assert
    await expect.poll(() => createInvite.mock.calls.length).toBeGreaterThan(0);
    expect(createInvite).toHaveBeenCalledWith("chana@example.com", "single", 7);
    await expect
      .poll(
        () => (screen.getByRole("textbox").element() as HTMLInputElement).value,
      )
      .toContain("/#/accept-invite/22222222-2222-2222-2222-222222222222");
  });
});

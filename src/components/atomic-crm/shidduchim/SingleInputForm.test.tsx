import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext } from "../types";
import { SingleInputForm } from "./SingleInputForm";

/**
 * Story 6.4 (AC 1, AC 2, AC 6): `SingleInputForm`'s own falsifiable claims —
 * it renders only for a settled `single` viewer (never while the role is
 * still resolving, never for any other role, AC 6's UX gate), and a submit
 * calls `create` against `interactions` with exactly the fixed shape Task 4
 * specifies, never naming `actor_member_id` or `account_id` (AC 2 — both are
 * server-set).
 */

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const PLACEHOLDER = "What do you think of this suggestion?";

const renderForm = async (
  role: MemberRole | undefined,
  dataProviderOverrides: Partial<DataProvider> = {},
) => {
  const contexts = role ? [contextFor(role)] : [];
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <SingleInputForm shidduchId={42} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("SingleInputForm — role gate (AC 6)", () => {
  it("renders nothing while the viewer role is still resolving", async () => {
    // Arrange — an in-flight, never-resolving query (the same idiom
    // NotesTab.test.tsx uses for its own loading-state case).
    const dataProvider = {
      getMyContexts: vi.fn().mockReturnValue(new Promise(() => {})),
      create: vi.fn(),
    } as unknown as DataProvider;
    const queryClient = new QueryClient();

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <SingleInputForm shidduchId={42} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    expect(screen.container.textContent ?? "").toBe("");
  });

  it("renders the labelled textarea and submit button for a single viewer", async () => {
    // Act
    const { screen } = await renderForm("single");

    // Assert
    await expect
      .element(screen.getByText("Share your input"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder(PLACEHOLDER))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Send" }))
      .toBeInTheDocument();
  });

  it.each(["parent_admin", "helper", "self_manager", "shadchan"] as const)(
    "renders nothing for a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderForm(role);

      // Assert
      expect(screen.container.textContent ?? "").toBe("");
    },
  );

  it("renders nothing for an unresolved role (no active membership) — fails closed", async () => {
    // Act
    const { screen } = await renderForm(undefined);

    // Assert
    expect(screen.container.textContent ?? "").toBe("");
  });
});

describe("SingleInputForm — submit payload (AC 1, AC 2)", () => {
  it("calls create against interactions with the exact fixed shape, never sending actor_member_id or account_id", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: { id: 1 } });

    // Act
    const { screen } = await renderForm("single", { create });
    await screen.getByPlaceholder(PLACEHOLDER).fill("I really liked this one");
    await screen.getByRole("button", { name: "Send" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [resource, params] = create.mock.calls[0];
    expect(resource).toBe("interactions");
    expect(params.data).toEqual({
      target_type: "shidduch",
      target_id: 42,
      scope: "shidduch",
      kind: "single_input",
      body: "I really liked this one",
    });
    expect(params.data).not.toHaveProperty("actor_member_id");
    expect(params.data).not.toHaveProperty("account_id");
  });

  it("does not submit an empty or whitespace-only input", async () => {
    // Arrange
    const create = vi.fn();

    // Act
    const { screen } = await renderForm("single", { create });
    await screen.getByPlaceholder(PLACEHOLDER).fill("   ");

    // Assert — disabled for whitespace-only input, so it is never
    // actionable in the first place.
    await expect
      .element(screen.getByRole("button", { name: "Send" }))
      .toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("clears the textarea after a successful submit", async () => {
    // Arrange
    const { screen } = await renderForm("single");
    const textarea = screen.getByPlaceholder(PLACEHOLDER);

    // Act
    await textarea.fill("temporary");
    await screen.getByRole("button", { name: "Send" }).click();

    // Assert
    await expect.element(textarea).toHaveValue("");
  });
});

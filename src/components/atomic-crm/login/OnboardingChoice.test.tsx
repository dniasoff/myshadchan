import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import { CoreAdminContext, type DataProvider } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";
import { MemoryRouter, useLocation } from "react-router";

import { OnboardingChoice } from "./OnboardingChoice";
import { DEMO_ONBOARDING_INTENT_QUERY_KEY } from "../root/onboardingKeys";
import type { MyPersona, Persona } from "../types";

/**
 * Pins 2.3 AC-2 (at least one, blocked inline), AC-3 (sequential
 * addPersona() calls, parent before single), AC-4 (single-only skips
 * straight to a finished record), AC-6 (shadchan-only skips straight to a
 * finished record naming the shadchanus context) and AC-7 (the demo path
 * provisions a household before seeding).
 */

const i18nProvider = {
  translate: (key: string, options?: { _?: string }) =>
    typeof options?._ === "string" ? options._ : key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "en" as const,
};

const PERSONA_LABELS: Record<Persona, string> = {
  single: "I'm looking for a shidduch for myself",
  parent: "I'm looking for a shidduch for my children",
  shadchan: "I'm a matchmaker (shadchan)",
};

/**
 * A real in-memory FakeRest provider (so FirstRunSetup's useUpdate/useCreate
 * calls have somewhere real to land) with `addPersona`/`getMyPersonas`/
 * `seedDemo` swapped for spies that record every call, in submission order,
 * into `calls` — mirroring how the real fakerest dataProvider wraps
 * `baseDataProvider` (providers/fakerest/dataProvider.ts).
 */
const buildDataProvider = (
  calls: string[],
  personasAfterSubmit: MyPersona[] = [],
): DataProvider => {
  const base = fakeDataProvider({
    members: [{ id: 0, first_name: "Jane", last_name: "Doe" }],
    accounts: [{ id: 42, name: "My Account" }],
    account_members: [],
    singles: [],
  });

  return {
    ...base,
    prepareDemoOnboarding: async () => {
      calls.push("prepareDemoOnboarding");
      return { state: "pending", account_id: null, attempts: 1 };
    },
    addPersona: async (persona: Persona) => {
      calls.push(`addPersona:${persona}`);
    },
    getMyPersonas: async () => personasAfterSubmit,
    seedDemo: async () => {
      calls.push("seedDemo");
      return { seeded: true };
    },
    currentAccountDemo: async () => false,
  } as unknown as DataProvider;
};

const renderOnboarding = (dataProvider: DataProvider) =>
  render(
    <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18nProvider}>
      <OnboardingChoice />
    </CoreAdminContext>,
  );

const goToPersonaSelect = async (
  screen: Awaited<ReturnType<typeof renderOnboarding>>,
) => {
  await screen.getByText("Start with my own family").click();
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe("OnboardingChoice — persona multi-select", () => {
  it("blocks Continue inline when nothing is ticked (AC-2)", async () => {
    // Arrange
    const calls: string[] = [];
    const screen = await renderOnboarding(buildDataProvider(calls));
    await goToPersonaSelect(screen);

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    await expect
      .element(screen.getByText("Pick at least one to continue."))
      .toBeVisible();
    expect(calls).toEqual([]);
  });

  it("calls addPersona sequentially, parent before single, when both are ticked (AC-3)", async () => {
    // Arrange
    const calls: string[] = [];
    const personasAfterSubmit: MyPersona[] = [
      {
        persona: "parent",
        account_id: 42,
        account_kind: "household",
        role: "parent_admin",
      },
    ];
    const screen = await renderOnboarding(
      buildDataProvider(calls, personasAfterSubmit),
    );
    await goToPersonaSelect(screen);

    // Act: tick single, then parent — UI order must not affect submit order.
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.single }).click();
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.parent }).click();
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    await expect
      .element(screen.getByText("Name your family's record"))
      .toBeVisible();
    expect(calls).toEqual(["addPersona:parent", "addPersona:single"]);
  });

  it("lands single-only on a finished record, never the 'add a single' step (AC-4)", async () => {
    // Arrange
    const calls: string[] = [];
    const screen = await renderOnboarding(buildDataProvider(calls));
    await goToPersonaSelect(screen);

    // Act
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.single }).click();
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    expect(calls).toEqual(["addPersona:single"]);
    await expect
      .element(
        screen.getByText(
          "Your record is ready. Start by logging a suggestion.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText("Add your first single"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Name your family's record"))
      .not.toBeInTheDocument();
  });

  it("provisions shadchan silently and names the shadchanus context on the done screen (AC-6)", async () => {
    // Arrange
    const calls: string[] = [];
    const screen = await renderOnboarding(buildDataProvider(calls));
    await goToPersonaSelect(screen);

    // Act
    await screen
      .getByRole("checkbox", { name: PERSONA_LABELS.shadchan })
      .click();
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    expect(calls).toEqual(["addPersona:shadchan"]);
    await expect
      .element(screen.getByText("Your shadchanus book is ready."))
      .toBeVisible();
    await expect
      .element(screen.getByText("Name your family's record"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Add your first single"))
      .not.toBeInTheDocument();
  });

  it("provisions a household before seeding the demo (AC-7)", async () => {
    // Arrange
    const calls: string[] = [];
    const screen = await renderOnboarding(buildDataProvider(calls));

    // Act
    await screen.getByText("Explore with demo data").click();

    // Assert
    await vi.waitFor(() => {
      expect(calls).toEqual([
        "prepareDemoOnboarding",
        "addPersona:parent",
        "seedDemo",
      ]);
    });
  });

  it("surfaces a notify error and re-enables Continue when addPersona rejects, allowing retry (review finding #10)", async () => {
    // Arrange: addPersona rejects once, then succeeds — pins that the error
    // path does not leave the button permanently disabled.
    const calls: string[] = [];
    let shouldFail = true;
    const base = fakeDataProvider({
      members: [{ id: 0, first_name: "Jane", last_name: "Doe" }],
      accounts: [{ id: 42, name: "My Account" }],
      account_members: [],
      singles: [],
    });
    const dataProvider = {
      ...base,
      addPersona: async (persona: Persona) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("Couldn't set that up. Try again.");
        }
        calls.push(`addPersona:${persona}`);
      },
      getMyPersonas: async () => [],
      seedDemo: async () => ({ seeded: true }),
      currentAccountDemo: async () => false,
    } as unknown as DataProvider;
    const screen = await renderOnboarding(dataProvider);
    await goToPersonaSelect(screen);
    await screen
      .getByRole("checkbox", { name: PERSONA_LABELS.shadchan })
      .click();

    // Act: first submit fails.
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: the notify error is shown, nothing was recorded.
    await expect
      .element(screen.getByText("Couldn't set that up. Try again."))
      .toBeVisible();
    expect(calls).toEqual([]);

    // Act: Continue is re-enabled — retrying the same submission succeeds.
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(calls).toEqual(["addPersona:shadchan"]);
    });
  });

  it("surfaces a notify error when the parent branch's post-provisioning getMyPersonas() read fails (review finding #10)", async () => {
    // Arrange: addPersona('parent') itself succeeds, but the follow-up
    // my_personas() read used to locate the new household's account_id
    // rejects — must not crash silently or strand the user.
    const calls: string[] = [];
    const base = fakeDataProvider({
      members: [{ id: 0, first_name: "Jane", last_name: "Doe" }],
      accounts: [{ id: 42, name: "My Account" }],
      account_members: [],
      singles: [],
    });
    const dataProvider = {
      ...base,
      addPersona: async (persona: Persona) => {
        calls.push(`addPersona:${persona}`);
      },
      getMyPersonas: async () => {
        throw new Error("Failed to load your account");
      },
      seedDemo: async () => ({ seeded: true }),
      currentAccountDemo: async () => false,
    } as unknown as DataProvider;
    const screen = await renderOnboarding(dataProvider);
    await goToPersonaSelect(screen);
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.parent }).click();

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    await expect
      .element(screen.getByText("Failed to load your account"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Name your family's record"))
      .not.toBeInTheDocument();
  });

  it("cancels an abandoned demo intent when the user chooses own family", async () => {
    const cancelDemoOnboarding = vi.fn().mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    queryClient.setQueryData(DEMO_ONBOARDING_INTENT_QUERY_KEY, {
      state: "failed",
      account_id: 42,
      attempts: 1,
    });
    const base = fakeDataProvider({
      members: [{ id: 0, first_name: "Jane", last_name: "Doe" }],
      accounts: [{ id: 42, name: "My Account" }],
      account_members: [],
      singles: [],
    });
    const dataProvider = {
      ...base,
      addPersona: vi.fn().mockResolvedValue(undefined),
      getMyPersonas: vi.fn().mockResolvedValue([]),
      cancelDemoOnboarding,
      currentAccountDemo: async () => false,
    } as unknown as DataProvider;

    const screen = await render(
      <MemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={i18nProvider}
          queryClient={queryClient}
        >
          <OnboardingChoice />
        </CoreAdminContext>
      </MemoryRouter>,
    );
    await goToPersonaSelect(screen);
    await screen
      .getByRole("checkbox", { name: PERSONA_LABELS.shadchan })
      .click();
    await screen.getByRole("button", { name: "Continue" }).click();
    await screen.getByRole("button", { name: "Go to my dashboard" }).click();

    await vi.waitFor(() => {
      expect(cancelDemoOnboarding).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData(DEMO_ONBOARDING_INTENT_QUERY_KEY),
      ).toBeNull();
    });
  });

  it("waits for ordinary-family cancellation before navigating, including a fail-soft rejection", async () => {
    let rejectCancellation!: (error: Error) => void;
    const cancelDemoOnboarding = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectCancellation = reject;
        }),
    );
    const queryClient = new QueryClient();
    const base = fakeDataProvider({
      members: [{ id: 0, first_name: "Jane", last_name: "Doe" }],
      accounts: [{ id: 42, name: "My Account" }],
      account_members: [],
      singles: [],
    });
    const dataProvider = {
      ...base,
      addPersona: vi.fn().mockResolvedValue(undefined),
      getMyPersonas: vi.fn().mockResolvedValue([]),
      cancelDemoOnboarding,
      currentAccountDemo: async () => false,
    } as unknown as DataProvider;

    const screen = await render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={i18nProvider}
          queryClient={queryClient}
        >
          <OnboardingChoice />
          <LocationProbe />
        </CoreAdminContext>
      </MemoryRouter>,
    );
    await goToPersonaSelect(screen);
    await screen
      .getByRole("checkbox", { name: PERSONA_LABELS.shadchan })
      .click();
    await screen.getByRole("button", { name: "Continue" }).click();
    await screen.getByRole("button", { name: "Go to my dashboard" }).click();

    await vi.waitFor(() => {
      expect(cancelDemoOnboarding).toHaveBeenCalledTimes(1);
    });
    await expect
      .element(screen.getByTestId("location"))
      .toHaveTextContent("/onboarding");

    rejectCancellation(new Error("simulated cancellation failure"));
    await expect.element(screen.getByTestId("location")).toHaveTextContent("/");
  });
});

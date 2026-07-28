import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { OnboardingChoice } from "./OnboardingChoice";
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
      .element(
        screen.getByText(
          "Your shadchanus book is ready. Start by adding a reference.",
        ),
      )
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
      expect(calls).toEqual(["addPersona:parent", "seedDemo"]);
    });
  });
});

import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";

import { OnboardingGate } from "./OnboardingGate";

/**
 * Pins 2.3 AC-1: onboarding shows exactly when a login holds no persona yet
 * (`my_personas()` returns zero rows) and the account is not in demo mode —
 * replacing the old `singles`-count gate.
 */

const i18nProvider = {
  translate: (key: string, options?: { _?: string }) =>
    typeof options?._ === "string" ? options._ : key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "en" as const,
};

const buildDataProvider = (overrides: {
  getMyPersonas: () => Promise<unknown[]>;
  currentAccountDemo: () => Promise<boolean>;
}): DataProvider => overrides as unknown as DataProvider;

const renderGate = (dataProvider: DataProvider) =>
  render(
    <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18nProvider}>
      <OnboardingGate>
        <div>The signed-in app</div>
      </OnboardingGate>
    </CoreAdminContext>,
  );

describe("OnboardingGate", () => {
  it("renders children while the personas query is pending", async () => {
    // Arrange: a promise that never resolves keeps isPending true.
    const dataProvider = buildDataProvider({
      getMyPersonas: () => new Promise(() => {}),
      currentAccountDemo: () => new Promise(() => {}),
    });

    // Act
    const screen = await renderGate(dataProvider);

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
  });

  it("shows the onboarding choice for a login with zero personas, not in demo mode", async () => {
    // Arrange
    const dataProvider = buildDataProvider({
      getMyPersonas: () => Promise.resolve([]),
      currentAccountDemo: () => Promise.resolve(false),
    });

    // Act
    const screen = await renderGate(dataProvider);

    // Assert
    await expect
      .element(screen.getByText("Welcome to MyShadchan"))
      .toBeVisible();
    await expect
      .element(screen.getByText("The signed-in app"))
      .not.toBeInTheDocument();
  });

  it("shows the app once any persona has been provisioned", async () => {
    // Arrange
    const dataProvider = buildDataProvider({
      getMyPersonas: () =>
        Promise.resolve([
          {
            persona: "parent",
            account_id: 1,
            account_kind: "household",
            role: "parent_admin",
          },
        ]),
      currentAccountDemo: () => Promise.resolve(false),
    });

    // Act
    const screen = await renderGate(dataProvider);

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
    await expect
      .element(screen.getByText("Welcome to MyShadchan"))
      .not.toBeInTheDocument();
  });

  it("shows the app for a personaless login already in demo mode", async () => {
    // Arrange
    const dataProvider = buildDataProvider({
      getMyPersonas: () => Promise.resolve([]),
      currentAccountDemo: () => Promise.resolve(true),
    });

    // Act
    const screen = await renderGate(dataProvider);

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
  });
});

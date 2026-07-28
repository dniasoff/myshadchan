import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import { CoreAdminContext, type DataProvider } from "ra-core";

import { OnboardingGate } from "./OnboardingGate";

/**
 * Pins 2.3 AC-1: onboarding shows exactly when a login holds no persona yet
 * (`my_personas()` returns zero rows) and the account is not in demo mode —
 * replacing the old `singles`-count gate.
 *
 * Also pins 2.7 review finding #2: a login that holds a context
 * (`my_contexts()` returns ≥1 row) is never onboarded, even with zero
 * personas — an invited `helper` or a `single`-role invitee before their
 * `singles` row exists both land in the app shell, not the welcome screen.
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
  getMyContexts?: () => Promise<unknown[]>;
}): DataProvider =>
  ({
    getMyContexts: () => Promise.resolve([]),
    ...overrides,
  }) as unknown as DataProvider;

const renderGate = (dataProvider: DataProvider) =>
  render(
    <CoreAdminContext
      dataProvider={dataProvider}
      i18nProvider={i18nProvider}
      // retry: false — without it, a rejecting getMyPersonas() (below) would
      // retry three times with backoff before settling into isError, making
      // that test slow instead of deterministic.
      queryClient={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
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

  it("shows the app for a personaless login that already holds a context (invited helper)", async () => {
    // Arrange: my_personas() reports zero rows (helper is not one of the
    // three onboarding personas) but my_contexts() reports the household
    // membership the invite already bound.
    const dataProvider = buildDataProvider({
      getMyPersonas: () => Promise.resolve([]),
      currentAccountDemo: () => Promise.resolve(false),
      getMyContexts: () =>
        Promise.resolve([
          {
            account_id: 1,
            kind: "household",
            name: "The Klein Family",
            role: "helper",
            is_active: true,
          },
        ]),
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

  it("shows the app, not onboarding, when getMyPersonas() rejects", async () => {
    // Arrange: getMyPersonas fail-loud (dataProvider.ts) means `data` is
    // `undefined` here — the gate must fail TOWARD the shell, never collapse
    // a read error into "zero personas" and re-run onboarding on an
    // existing user (review finding #1).
    const dataProvider = buildDataProvider({
      getMyPersonas: () =>
        Promise.reject(new Error("Failed to load your account")),
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

  it("shows the app, not onboarding, when getMyContexts() rejects", async () => {
    // Arrange: same fail-TOWARD-the-shell contract as getMyPersonas above,
    // now for the second query this gate reads (2.7 review finding #2).
    const dataProvider = buildDataProvider({
      getMyPersonas: () => Promise.resolve([]),
      currentAccountDemo: () => Promise.resolve(false),
      getMyContexts: () =>
        Promise.reject(new Error("Failed to load your contexts")),
    });

    // Act
    const screen = await renderGate(dataProvider);

    // Assert
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
    await expect
      .element(screen.getByText("Welcome to MyShadchan"))
      .not.toBeInTheDocument();
  });
});

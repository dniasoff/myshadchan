import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { CommunicationSection } from "./CommunicationSection";

/**
 * Story 7.5 (Task 7) — `PushNotificationsItem`'s own entry point, the gap
 * this story closes: `usePushSubscription.ts` was built and unit-tested
 * (`usePushSubscription.test.tsx`) with `CommunicationSection.tsx` never
 * rendering it — proven red against that unwired code below (the button
 * this suite clicks did not exist in the DOM at all before this fix).
 *
 * A separate file from `CommunicationSection.test.tsx` (a distinct concern
 * — the default-visibility radio vs. the push opt-in — and both stay under
 * the ~400-line typical ceiling per `.claude/rules/coding-style.md`), with
 * its own minimal harness: `canSetDefaultVisibility` only needs `contexts`
 * to never resolve (same shape `CommunicationSection.test.tsx`'s own
 * "contexts have not resolved" case uses) to stay false, which keeps every
 * test here scoped to the push section alone — `useGetOne("accounts", …)`
 * never even fires (`enabled: id != null`, ra-core's own default).
 *
 * Browser API stubbing mirrors `usePushSubscription.test.tsx`'s own
 * `Object.defineProperty(…, { configurable: true })` +
 * `Reflect.deleteProperty` shape, so this suite is deterministic regardless
 * of what the host (real, headless) Chromium actually supports.
 */

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyContexts: vi.fn().mockReturnValue(new Promise<never>(() => {})),
    getCurrentMemberId: vi.fn().mockResolvedValue(42),
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderCommunicationSection = async (
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <CommunicationSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

function stubGlobal(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true });
}

function clearStub(target: object, key: string): void {
  Reflect.deleteProperty(target, key);
}

describe("CommunicationSection — push opt-in entry point (Story 7.5, Task 7)", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("renders the opt-in with the delivery-not-live disclaimer, regardless of state", async () => {
    // Arrange
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", { permission: "default" });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });

    // Act
    const { screen } = await renderCommunicationSection();

    // Assert — the honesty clause: this story's own dispatch prompt asked
    // for it explicitly, not just an un-greyed control.
    await expect
      .element(screen.getByText("Push notifications"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Delivery is not live yet/))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Enable on this device" }))
      .not.toBeDisabled();
  });

  it("clicking Enable subscribes and persists via dataProvider.create('push_subscriptions', …)", async () => {
    // Arrange
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.test/ep-settings",
      toJSON: () => ({
        endpoint: "https://push.example.test/ep-settings",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      }),
    });
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", {
      permission: "default",
      requestPermission,
    });
    stubGlobal(navigator, "serviceWorker", {
      ready: Promise.resolve({ pushManager: { subscribe } }),
    });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "test-vapid-key");
    const create = vi.fn().mockResolvedValue({ data: { id: 1 } });

    // Act
    const { screen } = await renderCommunicationSection({ create });
    await screen.getByRole("button", { name: "Enable on this device" }).click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Enabled on this device" }))
      .toBeInTheDocument();
    expect(create).toHaveBeenCalledWith("push_subscriptions", {
      data: {
        member_id: 42,
        endpoint: "https://push.example.test/ep-settings",
        p256dh: "p256dh-value",
        auth: "auth-value",
      },
    });
  });

  it("disables the button and explains why, up front, when the browser has no PushManager", async () => {
    // Arrange — every iOS browser before an installed PWA looks like this.
    stubGlobal(window, "Notification", { permission: "default" });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });
    clearStub(window, "PushManager");

    // Act
    const { screen } = await renderCommunicationSection();

    // Assert — explained WITHOUT a click: a disabled button can never be
    // clicked to populate the hook's own errorMessage.
    await expect
      .element(screen.getByRole("button", { name: "Enable on this device" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText(/does not support push notifications/))
      .toBeInTheDocument();
  });

  it("explains itself proactively when permission is already denied, before any click", async () => {
    // Arrange — the browser will not re-prompt.
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", { permission: "denied" });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });

    // Act
    const { screen } = await renderCommunicationSection();

    // Assert
    await expect
      .element(screen.getByText(/Notifications are blocked for this site/))
      .toBeInTheDocument();
  });
});

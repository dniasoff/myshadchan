import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { usePushSubscription } from "./usePushSubscription";

/**
 * Story 7.5 (Task 7, AC-5, AC-12): the three explicit states Task 7 names
 * (unsupported browser, permission denied, success) plus the `demo` state
 * Task 9 asks for. Every browser API this hook touches
 * (`Notification`/`navigator.serviceWorker`/`window.PushManager`) is
 * replaced with a fully-controlled stub for each test — the same
 * `Object.defineProperty(…, { configurable: true })` +
 * `Reflect.deleteProperty` shape `ForwardResumeButton.test.tsx` already uses
 * for `navigator.share`/`navigator.canShare`, so the suite is deterministic
 * regardless of what the host (real, headless) Chromium actually supports
 * or how it resolves a real permission prompt.
 *
 * push_subscriptions has no FakeRest mirror in this stack's declared file
 * set (Task 9's "mirror in providers/fakerest/" bullet lives in
 * providers/fakerest/dataProvider.ts) — this harness supplies a minimal
 * hand-built `CrmDataProvider` instead of the full FakeRest engine, exactly
 * as ForwardResumeButton.test.tsx already does for its own dataProvider
 * calls, so this suite exercises the hook's own logic without depending on
 * a mirror that does not exist yet.
 */

function Harness({ readyTimeoutMs }: { readyTimeoutMs?: number } = {}) {
  const { state, errorMessage, subscribe } = usePushSubscription({
    readyTimeoutMs,
  });
  return (
    <div>
      <p>state: {state}</p>
      <p>error: {errorMessage ?? "(none)"}</p>
      <button type="button" onClick={() => void subscribe()}>
        Enable push notifications
      </button>
    </div>
  );
}

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getCurrentMemberId: vi.fn().mockResolvedValue(42),
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderHarness = async (
  dataProvider: CrmDataProvider,
  readyTimeoutMs?: number,
) => {
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Harness readyTimeoutMs={readyTimeoutMs} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen };
};

function stubGlobal(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true });
}

function clearStub(target: object, key: string): void {
  Reflect.deleteProperty(target, key);
}

describe("usePushSubscription — unsupported browser", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("reports unsupported, without ever prompting, when the browser has no PushManager", async () => {
    // Arrange — every iOS browser before an installed PWA looks like this.
    stubGlobal(window, "Notification", { permission: "default" });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });
    clearStub(window, "PushManager");

    // Act
    const { screen } = await renderHarness(buildDataProvider());

    // Assert
    await expect
      .element(screen.getByText("state: unsupported"))
      .toBeInTheDocument();
  });
});

describe("usePushSubscription — demo build", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("reports demo and never touches the Notification API, even on a fully-capable browser", async () => {
    // Arrange
    vi.stubEnv("VITE_IS_DEMO", "true");
    const requestPermission = vi.fn();
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", {
      permission: "default",
      requestPermission,
    });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });

    // Act
    const { screen } = await renderHarness(buildDataProvider());

    // Assert
    await expect.element(screen.getByText("state: demo")).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("usePushSubscription — permission denied", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("reports denied up front, before any click, when permission is already denied", async () => {
    // Arrange — the browser will not re-prompt, so this must be visible
    // without the user clicking anything.
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", { permission: "denied" });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });

    // Act
    const { screen } = await renderHarness(buildDataProvider());

    // Assert
    await expect.element(screen.getByText("state: denied")).toBeInTheDocument();
  });

  it("moves from idle to denied after an explicit opt-in the user declines", async () => {
    // Arrange
    const requestPermission = vi.fn().mockResolvedValue("denied");
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", {
      permission: "default",
      requestPermission,
    });
    stubGlobal(navigator, "serviceWorker", { ready: Promise.resolve() });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "test-vapid-key");

    // Act
    const { screen } = await renderHarness(buildDataProvider());
    await expect.element(screen.getByText("state: idle")).toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Enable push notifications" })
      .click();

    // Assert
    await expect.element(screen.getByText("state: denied")).toBeInTheDocument();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("usePushSubscription — service worker never becomes ready (Story 7.5 review fix, F2)", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("settles into the error state instead of hanging on 'subscribing' forever", async () => {
    // Arrange — a `ready` that never resolves, e.g. no service worker
    // registered at all (dev server, private browsing, enterprise policy).
    const requestPermission = vi.fn().mockResolvedValue("granted");
    stubGlobal(window, "PushManager", class {});
    stubGlobal(window, "Notification", {
      permission: "default",
      requestPermission,
    });
    stubGlobal(navigator, "serviceWorker", { ready: new Promise(() => {}) });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "test-vapid-key");

    // Act — a short override so this test does not wait out the real
    // (10s) production default. Use 200ms to avoid flakiness on loaded CI.
    const { screen } = await renderHarness(buildDataProvider(), 200);
    await screen
      .getByRole("button", { name: "Enable push notifications" })
      .click();
    await expect
      .element(screen.getByText("state: subscribing"))
      .toBeInTheDocument();

    // Assert — settles to `error` with an explanation, never stuck.
    await expect.element(screen.getByText("state: error")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/did not finish setting up/))
      .toBeInTheDocument();
  });
});

describe("usePushSubscription — success", () => {
  afterEach(() => {
    clearStub(window, "PushManager");
    clearStub(window, "Notification");
    clearStub(navigator, "serviceWorker");
    vi.unstubAllEnvs();
  });

  it("subscribes and persists member_id/endpoint/p256dh/auth via a plain dataProvider.create", async () => {
    // Arrange
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.test/ep-new",
      toJSON: () => ({
        endpoint: "https://push.example.test/ep-new",
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
    const dataProvider = buildDataProvider({ create });

    // Act
    const { screen } = await renderHarness(dataProvider);
    await screen
      .getByRole("button", { name: "Enable push notifications" })
      .click();

    // Assert
    await expect
      .element(screen.getByText("state: subscribed"))
      .toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    // ra-core's useCreate() consumes the `{ returnPromise: true }` mutation
    // option itself — the underlying dataProvider.create(resource, params)
    // call only ever receives the two arguments below, exactly like
    // ThreadPanel.tsx's Composer using the same shape for "messages".
    expect(create).toHaveBeenCalledWith("push_subscriptions", {
      data: {
        member_id: 42,
        endpoint: "https://push.example.test/ep-new",
        p256dh: "p256dh-value",
        auth: "auth-value",
      },
    });
  });

  it("surfaces a save failure as the error state rather than throwing unhandled", async () => {
    // Arrange
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.test/ep-fails",
      toJSON: () => ({
        endpoint: "https://push.example.test/ep-fails",
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
    const dataProvider = buildDataProvider({
      create: vi.fn().mockRejectedValue(new Error("network down")),
    });

    // Act
    const { screen } = await renderHarness(dataProvider);
    await screen
      .getByRole("button", { name: "Enable push notifications" })
      .click();

    // Assert
    await expect.element(screen.getByText("state: error")).toBeInTheDocument();
    await expect
      .element(screen.getByText("error: network down"))
      .toBeInTheDocument();
  });
});

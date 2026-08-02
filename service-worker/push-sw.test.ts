import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * Story 7.5 (Task 6, Task 7) — proves `public/push-sw.js` actually
 * registers the two listeners `vite.config.ts`'s `workbox.importScripts`
 * wiring depends on, and that each does what its own comments claim.
 *
 * This test lives OUTSIDE `public/`, even though its subject lives inside
 * it: everything under `public/` is copied verbatim into `dist/` on build
 * (Vite's own `publicDir` behaviour), so a `.test.ts` file placed there
 * would ship into the production bundle and — the concrete bug this
 * avoids — get picked up a second time as a stray failing suite when
 * Vitest's "app" project scans a `dist/` left over from a prior `make
 * build`. `public/push-sw.js` itself has no such problem: it MUST live in
 * `public/` to be servable as a plain top-level asset for `importScripts()`
 * (workbox-build's own documented mechanism, `vite.config.ts`) — only its
 * test needed to move.
 *
 * `push-sw.js` is a plain global-scope script meant to run inside a
 * `ServiceWorkerGlobalScope` — there is no such scope here, so this test
 * loads the raw source with Node `fs` and evaluates it with
 * `new Function("self", …)` against a fully-controlled fake `self`, the
 * same sandboxing shape `usePushSubscription.test.tsx` uses for
 * `Notification`/`navigator.serviceWorker`. Runs under the dedicated
 * "service-worker" Vitest project (`vitest.config.ts`) — a real Node
 * environment, unlike "app"'s real-browser one, which has no `fs`.
 */

const SOURCE = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
    "push-sw.js",
  ),
  "utf-8",
);

function loadIntoFakeSelf(self: Record<string, unknown>): void {
  // Sandboxes a same-repo, build-time-verified source file (not user
  // input) into a fake `self` — the only way to exercise a plain
  // ServiceWorkerGlobalScope script outside an actual service worker.
  new Function("self", SOURCE)(self);
}

function buildFakeSelf() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const self = {
    addEventListener: vi.fn(
      (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
    ),
    registration: { showNotification },
    clients: { matchAll, openWindow },
  };
  return { self, listeners, showNotification, openWindow, matchAll };
}

describe("push-sw.js — registers push and notificationclick (Story 7.5)", () => {
  it("registers exactly a 'push' and a 'notificationclick' listener", () => {
    // Arrange / Act
    const { self, listeners } = buildFakeSelf();
    loadIntoFakeSelf(self);

    // Assert
    expect(self.addEventListener).toHaveBeenCalledTimes(2);
    expect(listeners.has("push")).toBe(true);
    expect(listeners.has("notificationclick")).toBe(true);
  });

  it("'push' shows a fixed, generic notification — never parses event.data, matching webPush.ts's empty-payload send", async () => {
    // Arrange
    const { self, listeners, showNotification } = buildFakeSelf();
    loadIntoFakeSelf(self);
    let waited: Promise<unknown> | undefined;
    const event = {
      data: null,
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    };

    // Act
    listeners.get("push")!(event);
    await waited;

    // Assert
    expect(showNotification).toHaveBeenCalledExactlyOnceWith(
      "MyShadchan",
      expect.objectContaining({
        body: "You have a new message.",
        data: { url: "/" },
      }),
    );
  });

  it("'notificationclick' closes the notification and opens the app root when no window is already open", async () => {
    // Arrange
    const { self, listeners, openWindow, matchAll } = buildFakeSelf();
    matchAll.mockResolvedValue([]);
    loadIntoFakeSelf(self);
    let waited: Promise<unknown> | undefined;
    const close = vi.fn();
    const event = {
      notification: { close, data: { url: "/" } },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    };

    // Act
    listeners.get("notificationclick")!(event);
    await waited;

    // Assert
    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("'notificationclick' focuses an already-open window instead of opening a new one", async () => {
    // Arrange
    const { self, listeners, openWindow, matchAll } = buildFakeSelf();
    const focus = vi.fn().mockResolvedValue(undefined);
    matchAll.mockResolvedValue([{ focus }]);
    loadIntoFakeSelf(self);
    let waited: Promise<unknown> | undefined;
    const event = {
      notification: { close: vi.fn(), data: { url: "/" } },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    };

    // Act
    listeners.get("notificationclick")!(event);
    await waited;

    // Assert
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

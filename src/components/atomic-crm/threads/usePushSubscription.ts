import { useState } from "react";
import { useCreate } from "ra-core";

import { useCurrentMemberId } from "./useCurrentMemberId";

/**
 * Story 7.5 (Task 7, AC-5, AC-12): the client half of Web Push opt-in.
 *
 * Deliberately no `useEffect` that runs any of this on mount — an unprompted
 * `Notification.requestPermission()` is bad UX and, worse, permanently
 * blocks the origin in Chrome once a user dismisses it. `subscribe()` below
 * only ever runs from an explicit user action (a button's `onClick`); the
 * hook computes `state` eagerly ONLY for the two checks that need no
 * permission prompt at all (feature support, and an already-`denied`
 * permission) so the caller can disable/relabel the button before the user
 * even clicks it.
 *
 * `.claude/rules/coding-style.md` forbids swallowing errors silently — every
 * one of the four terminal states below (`unsupported`, `demo`, `denied`,
 * `error`) carries an explanation, and `subscribe()` never resolves
 * successfully without either reaching `subscribed` or setting one of them.
 *
 * FakeRest (the demo build, `VITE_IS_DEMO`) has no backend to run the cron
 * sweep against, so push delivery is inherently untestable there — this
 * hook's `demo` state is that expected limitation stated up front, not a
 * silently swallowed failure (Story 7.5 Dev Notes, "Why in-app delivery
 * needs no queue" / Task 9's FakeRest note make the same call for
 * `mark_thread_read`).
 *
 * `VITE_VAPID_PUBLIC_KEY`'s actual value is provisioned by whichever
 * environment deploys the Epic-12 Cloudflare Workers (Epic-12 gate G1) —
 * `vite.config.ts`'s production `define` block is the client-side half of
 * that wiring and now forwards it (Story 7.5 review fix, F1). Until the
 * key is actually set there, `subscribe()` reports `error` with a message
 * that names the missing configuration rather than throwing an unhandled
 * exception into the caller.
 */
export type PushSubscriptionState =
  | "idle"
  | "unsupported"
  | "demo"
  | "denied"
  | "subscribing"
  | "subscribed"
  | "error";

export interface UsePushSubscriptionResult {
  state: PushSubscriptionState;
  errorMessage: string | null;
  subscribe: () => Promise<void>;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isDemoBuild(): boolean {
  return import.meta.env.VITE_IS_DEMO === "true";
}

function initialState(): PushSubscriptionState {
  if (isDemoBuild()) return "demo";
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "idle";
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Story 7.5 review fix (F2): `navigator.serviceWorker.ready` simply never
 * resolves when no service worker ends up registered for the page (a dev
 * server with the PWA plugin's `autoUpdate` registration not yet run,
 * private-browsing modes that refuse persistent SW registration, an
 * enterprise policy blocking service workers, or a click landing before
 * the very first registration completes) — with no timeout, `subscribe()`
 * hung on it forever, leaving the button stuck on "Enabling…" with no
 * explanation. This is the only await in `subscribe()` whose underlying
 * promise is not already guaranteed to settle, so it is the only one that
 * needs racing against a timeout for this hook's own docstring guarantee
 * above ("`subscribe()` never resolves successfully without either
 * reaching `subscribed` or setting one of them") to actually hold.
 */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

function waitForServiceWorkerReady(
  timeoutMs: number,
): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          "Your browser did not finish setting up the notification service in time. Reload the page and try again.",
        ),
      );
    }, timeoutMs);

    navigator.serviceWorker.ready.then(
      (registration) => {
        clearTimeout(timer);
        resolve(registration);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface UsePushSubscriptionOptions {
  /** Override for tests only — production callers get the real default. */
  readyTimeoutMs?: number;
}

export function usePushSubscription(
  options: UsePushSubscriptionOptions = {},
): UsePushSubscriptionResult {
  const readyTimeoutMs =
    options.readyTimeoutMs ?? SERVICE_WORKER_READY_TIMEOUT_MS;
  const [state, setState] = useState<PushSubscriptionState>(initialState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [create] = useCreate();
  const { data: memberId } = useCurrentMemberId();

  const subscribe = async (): Promise<void> => {
    if (isDemoBuild()) {
      setState("demo");
      setErrorMessage(
        "Push notifications are not available in the demo build — there is no cron sweep behind it to deliver anything.",
      );
      return;
    }

    if (!isPushSupported()) {
      setState("unsupported");
      setErrorMessage(
        "This browser does not support push notifications (common on iOS unless the app is installed as a Home Screen app).",
      );
      return;
    }

    const applicationServerKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as
      string | undefined;
    if (!applicationServerKey) {
      setState("error");
      setErrorMessage(
        "Push notifications are not configured (VITE_VAPID_PUBLIC_KEY is missing).",
      );
      return;
    }

    if (memberId == null) {
      setState("error");
      setErrorMessage(
        "Could not resolve your membership — try again in a moment.",
      );
      return;
    }

    setState("subscribing");
    setErrorMessage(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // The browser will not re-prompt once denied — say so rather than
        // leaving the caller to guess why nothing happens on a retry.
        setState("denied");
        setErrorMessage(
          "Notifications were not allowed. Your browser will not ask again — allow them from your browser's site settings instead.",
        );
        return;
      }

      const registration = await waitForServiceWorkerReady(readyTimeoutMs);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(applicationServerKey),
      });
      const { p256dh, auth } = subscription.toJSON().keys ?? {};
      if (!p256dh || !auth) {
        throw new Error(
          "the browser did not return p256dh/auth keys for this subscription",
        );
      }

      await create(
        "push_subscriptions",
        {
          data: {
            member_id: memberId,
            endpoint: subscription.endpoint,
            p256dh,
            auth,
          },
        },
        { returnPromise: true },
      );

      setState("subscribed");
    } catch (error) {
      setState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to enable push notifications.",
      );
    }
  };

  return { state, errorMessage, subscribe };
}

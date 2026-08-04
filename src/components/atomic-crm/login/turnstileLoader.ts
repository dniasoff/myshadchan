const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** The slice of the real `window.turnstile` API this app uses. Declared by
 * hand — Cloudflare ships no npm types for the script-tag build. */
export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Loads Cloudflare's Turnstile script exactly once for the whole app —
 * every `<TurnstileWidget>` mount (sign-in, register, and any future OAuth
 * pre-step) shares this one promise instead of injecting its own
 * `<script>` tag, which would otherwise race and load the API twice.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise) {
    return scriptPromise;
  }
  if (typeof window !== "undefined" && window.turnstile) {
    scriptPromise = Promise.resolve(window.turnstile);
    return scriptPromise;
  }
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("Turnstile script loaded without window.turnstile"));
      }
    };
    script.onerror = () => {
      reject(new Error("Failed to load the Turnstile script"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Test-only: forgets the cached script promise so each test gets a clean load. */
export function resetTurnstileLoaderForTests(): void {
  scriptPromise = null;
}

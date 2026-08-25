import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./GoogleIcon";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { resolveAuthErrorNotification } from "./resolveAuthError";

export type GoogleSignInButtonProps = {
  /** @deprecated Supabase owns the OAuth callback and external navigation. */
  redirect?: string;
};

/**
 * Measured, not guessed. This timer can only ever observe ONE thing: whether
 * the browser has committed a new document yet. `signInWithOAuth()` makes no
 * network request at all — auth-js's `_handleProviderSignIn` builds the
 * provider URL locally and calls `window.location.assign()`, and the promise
 * resolves in microseconds regardless of the connection. So a redirect that
 * is merely SLOW is indistinguishable, to this code, from one that never
 * started.
 *
 * Ten seconds was not enough for that. The hand-off is two cold cross-origin
 * hops — `…supabase.co/auth/v1/authorize` (302) then `accounts.google.com` —
 * and on a phone with cold DNS, a cold TLS handshake and a sleeping radio
 * those cross 10s routinely. Reproduced against production at ~3.3s per
 * request: the toast fired at click+10.01s and the browser reached Google at
 * click+10.65s. The sign-in was working; the app called it broken.
 */
export const GOOGLE_OAUTH_REDIRECT_TIMEOUT_MS = 30_000;

/**
 * "Continue with Google" on `LoginPage` — a plain OAuth button. Clicking it
 * redirects to Google immediately. Renders nothing unless
 * `VITE_ENABLE_GOOGLE_OAUTH` is explicitly `"true"` (`isGoogleOAuthEnabled`,
 * `googleOAuth.ts`), so a deployment without the provider configured shows
 * no dead control.
 *
 * A visitor who is not registered yet and reaches for this button anyway
 * now gets an account, where the retired `check_signup_age()` Auth Hook
 * used to 403 the creation for lack of an affirmation. `signInWithOAuth()`
 * has no `shouldCreateUser` equivalent, so that hook was the only thing
 * holding the line and there is no longer a line to hold — `LoginPage`
 * therefore renders `AgeNotice` next to this button. What still separates
 * this component from `RegisterFlow`'s `GoogleSignUpButton` is only the
 * stalled-navigation timeout below, not whether an account can be created.
 *
 * Calls `authProvider.login()` directly rather than ra-core's `useLogin()`:
 * Supabase's `signInWithOAuth()` already owns the browser navigation via
 * `window.location.assign()`. Wrapping that call in `useLogin()` schedules a
 * second React Router navigation after the provider promise resolves; under
 * HashRouter, the absolute fallback URL becomes a malformed `/login/https:/…`
 * route and loops back through `/login` until Google's navigation wins.
 * `redirect` remains accepted as a deprecated no-op because this component is
 * distributed through the registry and downstream call sites may still pass
 * it; the callback destination continues to come from `authProvider.ts`.
 */
export const GoogleSignInButton = (_props: GoogleSignInButtonProps) => {
  const authProvider = useAuthProvider();
  const notify = useNotify();
  const translate = useTranslate();
  const [isPending, setIsPending] = useState(false);
  const attemptRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const detachNavigationListenersRef = useRef<(() => void) | null>(null);

  const clearRedirectTimeout = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    detachNavigationListenersRef.current?.();
    detachNavigationListenersRef.current = null;
  };

  // Inlined rather than calling `clearRedirectTimeout`, so the effect can keep
  // an empty dependency array without lying about what it closes over. Both
  // refs are stable, so this is the same work.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      detachNavigationListenersRef.current?.();
      detachNavigationListenersRef.current = null;
    },
    [],
  );

  if (!isGoogleOAuthEnabled()) {
    return null;
  }

  const notifyError = (error?: unknown) => {
    const fallback = {
      id: "crm.auth.google_oauth_not_configured",
      defaultMessage:
        "Google sign-in is not configured. Ask an administrator to enable and configure the Google provider in Supabase.",
    };
    const { id, defaultMessage } =
      error === undefined
        ? fallback
        : resolveAuthErrorNotification(error, fallback);
    notify(id, { type: "error", messageArgs: { _: defaultMessage } });
  };

  const handleClick = () => {
    if (isPending) {
      return;
    }
    if (!authProvider) {
      notifyError();
      return;
    }
    const attempt = ++attemptRef.current;
    setIsPending(true);
    clearRedirectTimeout();

    // The browser LEAVING this page is the only real success signal, and the
    // promise cannot carry it: `signInWithOAuth()` hands off through
    // `window.location.assign()` and resolves long before the navigation
    // commits. Chromium and Firefox fire `beforeunload` the moment the
    // navigation STARTS — measured 10 seconds before this timer fired, on a
    // redirect that went on to succeed — so listening for it disarms the
    // timer on a redirect that is only slow. `pagehide` fires at commit, and
    // with `persisted: true` on the way into bfcache, so a visitor who
    // reaches Google and presses Back does not return to a stale timer.
    //
    // Attached per click and removed in `clearRedirectTimeout()`: a permanent
    // `beforeunload` listener costs bfcache eligibility in Firefox.
    const disarm = () => clearRedirectTimeout();
    window.addEventListener("beforeunload", disarm);
    window.addEventListener("pagehide", disarm);
    detachNavigationListenersRef.current = () => {
      window.removeEventListener("beforeunload", disarm);
      window.removeEventListener("pagehide", disarm);
    };

    timeoutRef.current = window.setTimeout(() => {
      if (attemptRef.current !== attempt) {
        return;
      }
      clearRedirectTimeout();
      setIsPending(false);
      // Deliberately NOT an error. Neither `beforeunload` nor `pagehide`
      // reliably fires before commit on iOS Safari, so on that platform this
      // can still run while the redirect is genuinely in flight. We cannot
      // tell "blocked" from "slow", so the copy says only what is true and
      // the button becomes usable again.
      notify("crm.auth.google_oauth_slow", {
        type: "info",
        messageArgs: {
          _: "Still opening Google sign-in. If nothing happens, tap the button again.",
        },
      });
    }, GOOGLE_OAUTH_REDIRECT_TIMEOUT_MS);
    void authProvider
      .login({ oauthProvider: "google" })
      .catch((error: unknown) => {
        if (attemptRef.current !== attempt) {
          return;
        }
        clearRedirectTimeout();
        setIsPending(false);
        notifyError(error);
      });
    // On success the browser normally navigates away to Google. The timeout
    // above covers blocked or stalled navigation so the button never spins
    // forever when that hand-off does not happen.
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full cursor-pointer"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <GoogleIcon />
      )}
      {translate("crm.auth.login.continue_with_google", {
        _: "Continue with Google",
      })}
    </Button>
  );
};

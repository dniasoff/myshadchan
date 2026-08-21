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

export const GOOGLE_OAUTH_REDIRECT_TIMEOUT_MS = 10_000;

/**
 * "Continue with Google" on `LoginPage` — a plain OAuth button. Clicking it
 * redirects to Google immediately: signing in never creates an account (see
 * `LoginPage`'s own doc comment on `allowSignup`), so the 18+ affirmation
 * `check_signup_age()` (02_functions.sql) enforces only matters for a brand
 * new signup, and that gate lives entirely on `RegisterFlow`'s
 * `GoogleSignUpButton` instead. Renders nothing unless
 * `VITE_ENABLE_GOOGLE_OAUTH` is explicitly `"true"` (`isGoogleOAuthEnabled`,
 * `googleOAuth.ts`), so a deployment without the provider configured shows
 * no dead control.
 *
 * A visitor who is not actually registered yet and reaches for this button
 * anyway still lands on Google, but `check_signup_age()` then 403s the
 * account creation for lack of an affirmation — `resolveAuthErrorNotification`
 * surfaces that rejection once GoTrue redirects back with it. That is the
 * intended outcome: this button is for signing back in, `RegisterFlow`'s
 * `GoogleSignUpButton` is for creating an account.
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

  const clearRedirectTimeout = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
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
    timeoutRef.current = window.setTimeout(() => {
      if (attemptRef.current !== attempt) {
        return;
      }
      timeoutRef.current = null;
      setIsPending(false);
      notify("crm.auth.google_oauth_timeout", {
        type: "error",
        messageArgs: {
          _: "Google sign-in did not open. Check your browser settings and try again.",
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

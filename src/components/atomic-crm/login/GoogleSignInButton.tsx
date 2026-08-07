import { useState } from "react";
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
    setIsPending(true);
    authProvider.login({ oauthProvider: "google" }).catch((error: unknown) => {
      setIsPending(false);
      notifyError(error);
    });
    // No `.finally` resetting `isPending` on success: the browser is about
    // to navigate to Google, so there is no "after" to reset it in.
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

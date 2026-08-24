import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./GoogleIcon";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { resolveAuthErrorNotification } from "./resolveAuthError";

export type GoogleSignUpButtonProps = {
  /** @deprecated Supabase owns the OAuth callback and external navigation. */
  redirect?: string;
};

/**
 * "Continue with Google" on `RegisterFlow` — the signup counterpart to
 * `LoginPage`'s `GoogleSignInButton`. Redirects to Google immediately: the
 * 18+ affirmation is made by the act of creating an account (`AgeNotice`,
 * rendered once below this button), so nothing has to be collected — and
 * therefore transmitted — before the browser navigates away.
 *
 * It did once, and that is the whole reason this button previously demanded
 * an email. The retired `check_signup_age()` Auth Hook read the affirmation
 * out of the signup's `user_metadata`, which `signInWithOAuth()` cannot set
 * (its `queryParams` go to Google, not to Supabase), so the only channel
 * left was a `signup_intents` row keyed on an email the visitor had to type
 * first — for a button whose entire point is that Google already knows who
 * they are. With the hook gone the requirement goes with it.
 *
 * Calls `authProvider.login()` directly for the same reason as
 * `GoogleSignInButton`: Supabase owns the external navigation, so ra-core's
 * `useLogin()` must not schedule a competing HashRouter navigation after the
 * OAuth promise resolves. The deprecated `redirect` prop remains in the
 * public registry API as a no-op for downstream compatibility.
 */
export const GoogleSignUpButton = (_props: GoogleSignUpButtonProps) => {
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

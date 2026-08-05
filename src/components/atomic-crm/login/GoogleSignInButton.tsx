import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLogin, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./GoogleIcon";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { resolveAuthErrorNotification } from "./resolveAuthError";

export type GoogleSignInButtonProps = {
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
 */
export const GoogleSignInButton = ({
  redirect: redirectTo,
}: GoogleSignInButtonProps) => {
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();
  const [isPending, setIsPending] = useState(false);

  if (!isGoogleOAuthEnabled()) {
    return null;
  }

  const handleClick = () => {
    if (isPending) {
      return;
    }
    setIsPending(true);
    login(
      { oauthProvider: "google" },
      redirectTo ?? window.location.toString(),
    ).catch((error: unknown) => {
      setIsPending(false);
      const { id, defaultMessage } = resolveAuthErrorNotification(error, {
        id: "crm.auth.google_oauth_not_configured",
        defaultMessage:
          "Google sign-in is not configured. Ask an administrator to enable and configure the Google provider in Supabase.",
      });
      notify(id, { type: "error", messageArgs: { _: defaultMessage } });
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

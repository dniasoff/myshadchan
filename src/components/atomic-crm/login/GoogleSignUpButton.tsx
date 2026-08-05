import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLogin, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./GoogleIcon";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { resolveAuthErrorNotification } from "./resolveAuthError";
import { recordSignupIntent } from "./signupIntent";

export type GoogleSignUpButtonProps = {
  /** The email already typed into `RegisterFlow`'s own field. */
  email: string;
  /** True until the age-affirmation checkbox above this button is checked. */
  disabled: boolean;
  redirect?: string;
};

/**
 * "Continue with Google" on `RegisterFlow` — the signup counterpart to
 * `LoginPage`'s plain `GoogleSignInButton`. `signInWithOAuth()` navigates the
 * browser away before anything about the visitor is known, so there is no
 * "after the redirect" moment left to collect the 18+ affirmation
 * `check_signup_age()` (02_functions.sql) requires for a brand-new signup —
 * `RegisterFlow` collects it first (the `disabled` prop tracks its
 * `AgeAffirmation` checkbox) and this button stays inert until it's checked.
 * Once clicked, it records a `signup_intents` row for the already-entered
 * email (`recordSignupIntent`) and only then redirects to Google, with that
 * same email passed as `login_hint` so the consent screen defaults to it (a
 * hint, not an enforcement — `check_signup_age()`'s own email match is what
 * actually matters).
 */
export const GoogleSignUpButton = ({
  email,
  disabled,
  redirect: redirectTo,
}: GoogleSignUpButtonProps) => {
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();
  const [isPending, setIsPending] = useState(false);

  if (!isGoogleOAuthEnabled()) {
    return null;
  }

  const handleClick = () => {
    if (isPending || disabled) {
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      notify("crm.auth.register.email_required", {
        type: "error",
        messageArgs: { _: "Enter your email to continue." },
      });
      return;
    }
    setIsPending(true);
    recordSignupIntent(trimmedEmail)
      .then(() =>
        login(
          { oauthProvider: "google", loginHint: trimmedEmail },
          redirectTo ?? window.location.toString(),
        ),
      )
      .catch((error: unknown) => {
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
      disabled={isPending || disabled}
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

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLogin, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgeAffirmation } from "./AgeAffirmation";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { recordSignupIntent } from "./signupIntent";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
    />
  </svg>
);

/**
 * Reads the real error message off a rejected call, narrowing the
 * `unknown` catch value safely (see .claude/rules/typescript.md). Falls
 * back to a translatable, intelligible default when the error carries none
 * of its own (e.g. the Google provider isn't enabled/configured on the
 * Supabase instance).
 */
function getOAuthErrorMessage(error: unknown): {
  id: string;
  defaultMessage: string;
} {
  if (typeof error === "string" && error.length > 0) {
    return { id: error, defaultMessage: error };
  }
  if (error instanceof Error && error.message) {
    return { id: error.message, defaultMessage: error.message };
  }
  return {
    id: "crm.auth.google_oauth_not_configured",
    defaultMessage:
      "Google sign-in is not configured. Ask an administrator to enable and configure the Google provider in Supabase.",
  };
}

type GoogleStep = "button" | "collecting";

export type GoogleSignInButtonProps = {
  redirect?: string;
};

/**
 * "Continue with Google" — social OAuth via Supabase. Requires the Google
 * provider to be enabled in the Supabase dashboard; renders nothing unless
 * `VITE_ENABLE_GOOGLE_OAUTH` is explicitly `"true"`, so a deployment
 * without the provider configured shows no dead control
 * (`isGoogleOAuthEnabled`, `googleOAuth.ts`).
 *
 * Unlike a plain OAuth button, clicking this one does NOT redirect
 * immediately. `signInWithOAuth()` navigates the browser away before
 * anything about the visitor is known, so there is no "after the redirect"
 * moment left to collect the 18+ affirmation `check_signup_age()`
 * (02_functions.sql) requires for a brand-new signup. Instead, clicking
 * reveals a small email + age-affirmation step; only once that's confirmed
 * do we record a `signup_intents` row for that email (`recordSignupIntent`)
 * and THEN redirect to Google, with that same email passed as `login_hint`
 * so the consent screen defaults to it (a hint, not an enforcement —
 * `check_signup_age()`'s own email match is what actually matters).
 *
 * This runs unconditionally, even for a visitor who already has an account
 * and is simply signing back in — there is no reliable way to tell the two
 * cases apart before Google has authenticated anyone, and asking twice is
 * far cheaper than the alternative (a returning user's real signup getting
 * silently 403'd because nothing pre-authorized their new-account age
 * affirmation before the redirect).
 */
export const GoogleSignInButton = ({
  redirect: redirectTo,
}: GoogleSignInButtonProps) => {
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();
  const [step, setStep] = useState<GoogleStep>("button");
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);

  if (!isGoogleOAuthEnabled()) {
    return null;
  }

  const handleContinue = () => {
    if (isPending) {
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      notify("crm.auth.google_step.email_required", {
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
        const { id, defaultMessage } = getOAuthErrorMessage(error);
        notify(id, { type: "error", messageArgs: { _: defaultMessage } });
      });
    // No `.finally` resetting `isPending` on success: the browser is about
    // to navigate to Google, so there is no "after" to reset it in.
  };

  if (step === "button") {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full cursor-pointer"
        onClick={() => setStep("collecting")}
      >
        <GoogleIcon />
        {translate("crm.auth.login.continue_with_google", {
          _: "Continue with Google",
        })}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-start">
        <label
          htmlFor="google-signin-email"
          className="text-sm font-medium text-foreground"
        >
          {translate("crm.auth.google_step.email_label", { _: "Email" })}
        </label>
        <Input
          id="google-signin-email"
          type="email"
          autoComplete="email"
          value={email}
          disabled={isPending}
          onChange={(event) => setEmail(event.target.value)}
          className={AUTH_FIELD_CLASSNAME}
        />
      </div>
      <AgeAffirmation onContinue={handleContinue} compact />
      {isPending ? (
        <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {translate("crm.auth.google_step.preparing", {
            _: "One moment…",
          })}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setStep("button")}
          className={cn(
            "block w-full text-center text-sm text-muted-foreground",
            "hover:text-foreground hover:underline",
          )}
        >
          {translate("crm.auth.google_step.back", { _: "Back" })}
        </button>
      )}
    </div>
  );
};

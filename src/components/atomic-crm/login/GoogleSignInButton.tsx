import { useState, type ComponentProps, type MouseEvent } from "react";
import { useLogin, useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isGoogleOAuthEnabled } from "./googleOAuth";

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
 * Reads the real error message off a rejected login() call, narrowing the
 * `unknown` catch value safely (see .claude/rules/typescript.md). When the
 * error carries no message of its own (e.g. the Google provider isn't
 * enabled/configured on the Supabase instance), falls back to an intelligible,
 * translatable default instead of the generic "ra.auth.sign_in_error" (whose
 * copy — "Authentication failed, please retry" — wrongly implies retrying
 * will help).
 */
function getOAuthErrorMessage(error: unknown): {
  id: string;
  defaultMessage?: string;
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

/**
 * Standard "Sign in with Google" (social OAuth via Supabase). Requires the
 * Google provider to be enabled in the Supabase dashboard. Distinct from
 * SSOAuthButton, which does enterprise SAML SSO by email domain.
 *
 * Note: supabase-js's signInWithOAuth() builds the redirect URL entirely
 * client-side and navigates the browser away immediately — it never makes a
 * network call first, so it cannot reject just because the provider is
 * disabled/misconfigured server-side. In that case Supabase Auth itself
 * (GoTrue) is what returns the error, on the page the browser lands on after
 * the redirect. The catch handler below still covers every error this call
 * *can* actually throw (network/client-side failures) and gives them a clear
 * message instead of react-admin's generic default.
 *
 * Renders nothing unless `VITE_ENABLE_GOOGLE_OAUTH` is explicitly enabled, so a
 * deployment without the provider configured shows no dead control.
 */
export const GoogleSignInButton = ({
  children,
  redirect: redirectTo,
  ...props
}: GoogleSignInButtonProps) => {
  const login = useLogin();
  const notify = useNotify();
  const [isPending, setIsPending] = useState(false);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsPending(true);
    login(
      { oauthProvider: "google" },
      redirectTo ?? window.location.toString(),
    ).catch((error: unknown) => {
      setIsPending(false);
      const { id, defaultMessage } = getOAuthErrorMessage(error);
      notify(id, { type: "error", messageArgs: { _: defaultMessage } });
    });
  };

  if (!isGoogleOAuthEnabled()) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
      {...props}
    >
      {isPending ? (
        <Spinner className="size-4" data-icon="inline-start" />
      ) : (
        <GoogleIcon />
      )}
      {children ?? "Sign in with Google"}
    </Button>
  );
};

export type GoogleSignInButtonProps = {
  redirect?: string;
} & ComponentProps<typeof Button>;

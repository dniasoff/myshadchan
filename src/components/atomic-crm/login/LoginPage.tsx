import { useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Form, required, useLogin, useNotify, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext.tsx";
import { AuthLayout } from "./AuthLayout";
import { SSOAuthButton } from "./SSOAuthButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { PasswordInput } from "./PasswordInput";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

/**
 * Login page displayed when authentication is enabled and the user is not authenticated.
 *
 * Automatically shown when an unauthenticated user tries to access a protected route.
 * Handles login via authProvider.login() and displays error notifications on failure.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/loginpage LoginPage documentation}
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/security Security documentation}
 */
export const LoginPage = (props: { redirectTo?: string }) => {
  const { googleWorkplaceDomain, disableEmailPasswordAuthentication } =
    useConfigurationContext();
  const { redirectTo } = props;
  const [loading, setLoading] = useState(false);
  const hasDisplayedRecoveryNotification = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldNotify = searchParams.get("passwordRecoveryEmailSent") === "1";

    if (!shouldNotify || hasDisplayedRecoveryNotification.current) {
      return;
    }

    hasDisplayedRecoveryNotification.current = true;
    notify("crm.auth.recovery_email_sent", {
      type: "success",
      messageArgs: {
        _: "If you're a registered user, you should receive a password recovery email shortly.",
      },
    });

    searchParams.delete("passwordRecoveryEmailSent");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, notify]);

  const handleSubmit: SubmitHandler<FieldValues> = (values) => {
    setLoading(true);
    login(values, redirectTo)
      .then(() => {
        setLoading(false);
      })
      .catch((error) => {
        setLoading(false);
        notify(
          typeof error === "string"
            ? error
            : typeof error === "undefined" || !error.message
              ? "ra.auth.sign_in_error"
              : error.message,
          {
            type: "error",
            messageArgs: {
              _:
                typeof error === "string"
                  ? error
                  : error && error.message
                    ? error.message
                    : undefined,
            },
          },
        );
      });
  };

  const googleEnabled = isGoogleOAuthEnabled();

  return (
    <AuthLayout
      footer={
        <>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            {translate("crm.auth.footer_private", {
              _: "Private to your family",
            })}
          </span>
          <a href="/" className="hover:text-foreground hover:underline">
            {translate("crm.auth.back_to_home", { _: "Back to home" })}
          </a>
        </>
      }
    >
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.login.title", { _: "Welcome back" })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("crm.auth.login.subtitle", {
              _: "Sign in to your records.",
            })}
          </p>
        </div>

        {googleEnabled || googleWorkplaceDomain ? (
          <div className="space-y-3">
            {googleEnabled ? (
              <GoogleSignInButton className="h-11 w-full rounded-lg" />
            ) : null}
            {googleWorkplaceDomain ? (
              <SSOAuthButton
                className="h-11 w-full rounded-lg"
                domain={googleWorkplaceDomain}
              >
                {translate("crm.auth.sign_in_google_workspace", {
                  _: "Sign in with Google Workplace",
                })}
              </SSOAuthButton>
            ) : null}
            {disableEmailPasswordAuthentication ? null : (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  or continue with email
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
            )}
          </div>
        ) : null}

        {disableEmailPasswordAuthentication ? null : (
          <Form className="space-y-4" onSubmit={handleSubmit}>
            <TextInput
              label="ra.auth.email"
              source="email"
              type="email"
              autoComplete="email"
              inputClassName={AUTH_FIELD_CLASSNAME}
              validate={required()}
            />
            <PasswordInput
              label="ra.auth.password"
              source="password"
              autoComplete="current-password"
              validate={required()}
            />
            <Button
              type="submit"
              className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {translate("ra.auth.sign_in")}
            </Button>
          </Form>
        )}

        {disableEmailPasswordAuthentication ? null : (
          <Link
            to={"/forgot-password"}
            className="block text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {translate("ra-supabase.auth.forgot_password", {
              _: "Forgot password?",
            })}
          </Link>
        )}
      </div>
    </AuthLayout>
  );
};

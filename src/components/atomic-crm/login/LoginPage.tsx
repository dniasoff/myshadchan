import { useEffect, useRef, useState } from "react";
import { Form, required, useLogin, useNotify, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { Notification } from "@/components/admin/notification";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext.tsx";
import { SSOAuthButton } from "./SSOAuthButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { AuthHero, LedgerMark } from "./AuthHero";

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

  const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === "true";

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Vibrant brand / hero panel */}
      <AuthHero />

      {/* ---------------- Sign-in panel ---------------- */}
      <div className="flex min-h-screen flex-col justify-center bg-background p-6 lg:p-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="flex items-center gap-2 lg:hidden">
            <div
              className="grid h-9 w-9 place-items-center rounded-lg text-white"
              style={{ background: "var(--primary)" }}
            >
              <LedgerMark className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              My
              <span style={{ color: "var(--primary)" }}>Shadchan</span>
            </span>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your shadchan book.
            </p>
          </div>

          {googleEnabled || googleWorkplaceDomain ? (
            <div className="space-y-3">
              {googleEnabled ? <GoogleSignInButton className="w-full" /> : null}
              {googleWorkplaceDomain ? (
                <SSOAuthButton
                  className="w-full"
                  domain={googleWorkplaceDomain}
                >
                  {translate("crm.auth.sign_in_google_workspace", {
                    _: "Sign in with Google Workplace",
                  })}
                </SSOAuthButton>
              ) : null}
              {disableEmailPasswordAuthentication ? null : (
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
                      or continue with email
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {disableEmailPasswordAuthentication ? null : (
            <Form className="space-y-5" onSubmit={handleSubmit}>
              <TextInput
                label="ra.auth.email"
                source="email"
                type="email"
                validate={required()}
              />
              <TextInput
                label="ra.auth.password"
                source="password"
                type="password"
                validate={required()}
              />
              <Button
                type="submit"
                className="w-full cursor-pointer"
                disabled={loading}
              >
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
      </div>

      <Notification />
    </div>
  );
};

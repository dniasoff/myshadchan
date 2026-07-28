import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import {
  Form,
  required,
  useAuthProvider,
  useLogin,
  useNotify,
  useTranslate,
} from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";
import { AuthLayout } from "./AuthLayout";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

type LoginStep = "email" | "code";

interface NotifyFallback {
  id: string;
  defaultMessage: string;
}

/**
 * Reads the real error message off a rejected authProvider.login() call,
 * narrowing the `unknown` catch value safely (see .claude/rules/typescript.md),
 * and falls back to a translatable default when the rejection carries none.
 */
function resolveErrorNotification(
  error: unknown,
  fallback: NotifyFallback,
): { id: string; defaultMessage: string } {
  if (typeof error === "string" && error.length > 0) {
    return { id: error, defaultMessage: error };
  }
  if (error instanceof Error && error.message) {
    return { id: error.message, defaultMessage: error.message };
  }
  return fallback;
}

/**
 * Login page displayed when authentication is enabled and the user is not
 * authenticated. Passwordless, two-step (AD-11 — no password, no second
 * authentication path): an email step requests a 6-digit code
 * (`authProvider.login({ email, requestOtp: true })`), then a code step
 * verifies it (`authProvider.login({ email, token, verifyOtp: true })`).
 * Both route through the same `authProvider.login()` entry point that
 * `params.oauthProvider` / `params.ssoDomain` used to.
 *
 * The email step calls the authProvider directly (via `useAuthProvider()`)
 * instead of through `useLogin()`: `useLogin()` navigates to the
 * authenticated area on every resolved call, which is correct once sign-in
 * actually completes (the code step, below) but would be a premature
 * navigation for a step that only sends an email and never authenticates
 * anyone.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/loginpage LoginPage documentation}
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/security Security documentation}
 */
export const LoginPage = (props: { redirectTo?: string }) => {
  const { redirectTo } = props;
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const authProvider = useAuthProvider();
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();

  const notifyError = (error: unknown, fallback: NotifyFallback) => {
    const { id, defaultMessage } = resolveErrorNotification(error, fallback);
    notify(id, { type: "error", messageArgs: { _: defaultMessage } });
  };

  const requestCode = (targetEmail: string) => {
    if (!authProvider) {
      return Promise.reject(new Error("Authentication is not configured."));
    }
    return authProvider.login({ email: targetEmail, requestOtp: true });
  };

  const handleRequestCode: SubmitHandler<FieldValues> = (values) => {
    const submittedEmail = String(values.email ?? "").trim();
    setIsRequesting(true);
    requestCode(submittedEmail)
      .then(() => {
        setEmail(submittedEmail);
        setStep("code");
      })
      .catch((error: unknown) => {
        notifyError(error, {
          id: "ra.auth.sign_in_error",
          defaultMessage: "Authentication failed, please retry",
        });
      })
      .finally(() => setIsRequesting(false));
  };

  const handleVerifyCode: SubmitHandler<FieldValues> = (values) => {
    setIsVerifying(true);
    login({ email, token: values.token, verifyOtp: true }, redirectTo)
      .catch((error: unknown) => {
        notifyError(error, {
          id: "crm.auth.login.invalid_code",
          defaultMessage: "That code is incorrect or has expired.",
        });
      })
      .finally(() => setIsVerifying(false));
  };

  const handleResend = () => {
    requestCode(email)
      .then(() => {
        notify("crm.auth.login.code_resent", {
          messageArgs: { _: "Code sent again" },
        });
      })
      .catch((error: unknown) => {
        notifyError(error, {
          id: "ra.auth.sign_in_error",
          defaultMessage: "Authentication failed, please retry",
        });
      });
  };

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
            {step === "email"
              ? translate("crm.auth.login.subtitle", {
                  _: "Sign in to your records.",
                })
              : translate("crm.auth.login.code_sent_to", {
                  email,
                  _: "We sent a 6-digit code to %{email}.",
                })}
          </p>
        </div>

        {step === "email" ? (
          <Form
            key="email-step"
            className="space-y-4"
            defaultValues={{ email }}
            onSubmit={handleRequestCode}
          >
            <TextInput
              label="ra.auth.email"
              source="email"
              type="email"
              autoComplete="email"
              inputClassName={AUTH_FIELD_CLASSNAME}
              validate={required()}
            />
            <Button
              type="submit"
              className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
              disabled={isRequesting}
            >
              {isRequesting ? (
                <Loader2
                  className="me-2 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {translate("crm.auth.login.send_code", { _: "Send code" })}
            </Button>
          </Form>
        ) : (
          <Form
            key="code-step"
            className="space-y-4"
            onSubmit={handleVerifyCode}
          >
            <TextInput
              label="crm.auth.login.code_label"
              source="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              inputClassName={AUTH_FIELD_CLASSNAME}
              validate={required()}
            />
            <Button
              type="submit"
              className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
              disabled={isVerifying}
            >
              {isVerifying ? (
                <Loader2
                  className="me-2 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {translate("ra.auth.sign_in")}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setStep("email")}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {translate("crm.auth.login.use_different_email", {
                  _: "Use a different email",
                })}
              </button>
              <button
                type="button"
                onClick={handleResend}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {translate("crm.auth.login.resend_code", {
                  _: "Resend code",
                })}
              </button>
            </div>
          </Form>
        )}
      </div>
    </AuthLayout>
  );
};

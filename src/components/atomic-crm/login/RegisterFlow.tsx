import { useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useAuthProvider, useLogin, useNotify, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { AgeAffirmation } from "./AgeAffirmation";
import { AuthLayout } from "./AuthLayout";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { OtpCodeStep } from "./OtpCodeStep";
import { resolveAuthErrorNotification } from "./resolveAuthError";
import { TurnstileWidget, type TurnstileWidgetHandle } from "./TurnstileWidget";
import { TURNSTILE_SITE_KEY } from "./turnstileConfig";

type RegisterStep = "details" | "code";

/**
 * The open self-service signup path (`/register`), the counterpart to
 * `LoginPage`'s sign-in form now that the invite gate is gone
 * (`20260804214603_open_signup.sql`; `check_signup_age()`, 02_functions.sql,
 * is the server-side enforcement of the 18+ affirmation this screen
 * collects). Composes exactly the pieces already built for this: an email
 * field, `AgeAffirmation` (compact — its own "Continue" button IS the
 * submit trigger, there is no separate button here), `TurnstileWidget`, then
 * `OtpCodeStep` once a code has been sent.
 *
 * Reached from `LoginPage`'s "Create one" link and registered as a `chrome:
 * "bare"` route (`root/routeManifest.ts`) — same pre-auth, outside-the-shell
 * placement as `InviteAcceptance`, since a not-yet-authenticated visitor
 * cannot reach anything inside the app shell.
 *
 * `allowSignup: true` is passed here and ONLY here on this screen (mirroring
 * `InviteAcceptance`, the only other caller that ever sets it) — `LoginPage`
 * hard-omits it so signing in can never silently create an account.
 * `captchaToken` is forwarded on every `requestOtp` call (the initial send
 * AND a resend) for the same reason `LoginPage`'s sign-in form now does:
 * Supabase's captcha gate is project-wide, not per-endpoint, so this path
 * must already be sending a token before `security_captcha_enabled` is ever
 * flipped on (see `turnstileConfig.ts`). `TurnstileWidget` is mounted
 * unconditionally across BOTH steps (never inside the `step === "details"`
 * branch) so a resend on the code step reuses the same live widget instance
 * instead of re-solving a challenge the visitor already passed seconds
 * earlier — see `TurnstileWidget`'s own doc comment.
 */
export const RegisterFlow = (props: { redirectTo?: string }) => {
  const { redirectTo } = props;
  const [step, setStep] = useState<RegisterStep>("details");
  const [email, setEmail] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const authProvider = useAuthProvider();
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();

  const notifyError = (
    error: unknown,
    fallback: { id: string; defaultMessage: string },
  ) => {
    const { id, defaultMessage } = resolveAuthErrorNotification(
      error,
      fallback,
    );
    notify(id, { type: "error", messageArgs: { _: defaultMessage } });
  };

  const requestCode = (targetEmail: string) => {
    if (!authProvider) {
      return Promise.reject(new Error("Authentication is not configured."));
    }
    return authProvider.login({
      email: targetEmail,
      requestOtp: true,
      allowSignup: true,
      meta: { age_affirmed: true },
      captchaToken: captchaToken ?? undefined,
    });
  };

  const handleContinue = () => {
    if (isRequesting) {
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
    setIsRequesting(true);
    requestCode(trimmedEmail)
      .then(() => {
        setEmail(trimmedEmail);
        setStep("code");
        turnstileRef.current?.reset();
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
    login({ email, token: values.token, verifyOtp: true }, redirectTo).catch(
      (error: unknown) => {
        notifyError(error, {
          id: "crm.auth.login.invalid_code",
          defaultMessage: "That code is incorrect or has expired.",
        });
        setIsVerifying(false);
      },
    );
  };

  const handleResend = () => {
    requestCode(email)
      .then(() => {
        notify("crm.auth.login.code_resent", {
          messageArgs: { _: "Code sent again" },
        });
        turnstileRef.current?.reset();
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
        {/* Only the details step renders its own header: `OtpCodeStep`
            brings its own heading and "we sent a code to…" line, so keeping
            this block on the code step printed that sentence twice. */}
        {step === "details" ? (
          <div className="text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              {translate("crm.auth.register.title", {
                _: "Create your account",
              })}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {translate("crm.auth.register.subtitle", {
                _: "It only takes a minute.",
              })}
            </p>
          </div>
        ) : null}

        {step === "details" ? (
          <div className="space-y-6">
            <div className="space-y-1.5 text-start">
              <label
                htmlFor="register-email"
                className="text-sm font-medium text-foreground"
              >
                {translate("ra.auth.email", { _: "Email" })}
              </label>
              <Input
                id="register-email"
                type="email"
                autoComplete="email"
                value={email}
                disabled={isRequesting}
                onChange={(event) => setEmail(event.target.value)}
                className={AUTH_FIELD_CLASSNAME}
              />
            </div>
            <AgeAffirmation onContinue={handleContinue} compact />
            {isRequesting ? (
              <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {translate("crm.auth.register.sending_code", {
                  _: "Sending your code…",
                })}
              </p>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {translate("crm.auth.register.have_account", {
                  _: "Already have an account?",
                })}{" "}
                <Link
                  to="/login"
                  className="font-medium text-foreground hover:underline"
                >
                  {translate("crm.auth.register.sign_in", {
                    _: "Sign in",
                  })}
                </Link>
              </p>
            )}
          </div>
        ) : (
          <OtpCodeStep
            email={email}
            isVerifying={isVerifying}
            onSubmit={handleVerifyCode}
            onResend={handleResend}
            title={{
              id: "crm.auth.register.title",
              defaultMessage: "Create your account",
            }}
          />
        )}

        <TurnstileWidget
          ref={turnstileRef}
          siteKey={TURNSTILE_SITE_KEY}
          onToken={setCaptchaToken}
        />
      </div>
    </AuthLayout>
  );
};

RegisterFlow.path = "/register";

import { useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useAuthProvider, useLogin, useNotify, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { AgeNotice } from "./AgeNotice";
import { AuthLayout } from "./AuthLayout";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { GoogleSignUpButton } from "./GoogleSignUpButton";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { OtpCodeStep } from "./OtpCodeStep";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";
import { resolveAuthErrorNotification } from "./resolveAuthError";
import { TurnstileWidget, type TurnstileWidgetHandle } from "./TurnstileWidget";
import { TURNSTILE_SITE_KEY } from "./turnstileConfig";

type RegisterStep = "details" | "code";

/**
 * The open self-service signup path (`/register`), the counterpart to
 * `LoginPage`'s sign-in form now that the invite gate is gone
 * (`20260804214603_open_signup.sql`). Composes an email field, a "Continue"
 * button, `TurnstileWidget`, then `OtpCodeStep` once a code has been sent.
 *
 * The 18+ affirmation is made by the act of creating an account and stated
 * as such (`AgeNotice`, rendered once below BOTH account-creating controls
 * on this screen). It used to be a checkbox whose state had to reach the
 * server through `check_signup_age()`'s Auth Hook; that hook is retired,
 * along with the `signup_intents` table that was the OAuth path's only way
 * to carry it — see `AgeNotice`'s own doc comment for why the checkbox and
 * the Google button's former email requirement were the same constraint.
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
 *
 * Also renders `GoogleSignUpButton` (only when `isGoogleOAuthEnabled()`) as
 * an alternate way to finish this same signup — it needs nothing from this
 * screen at all now, not even the email, and redirects on click.
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
      captchaToken: captchaToken ?? undefined,
    });
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
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
        resetCaptcha();
      })
      .catch((error: unknown) => {
        resetCaptcha();
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
        resetCaptcha();
      })
      .catch((error: unknown) => {
        resetCaptcha();
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
          <nav className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground hover:underline">
              {translate("crm.auth.footer.terms", { _: "Terms of Service" })}
            </Link>
            <Link
              to="/privacy"
              className="hover:text-foreground hover:underline"
            >
              {translate("crm.auth.footer.privacy", { _: "Privacy Policy" })}
            </Link>
            <Link
              to="/sub-processors"
              className="hover:text-foreground hover:underline"
            >
              {translate("crm.auth.footer.subprocessors", {
                _: "Sub-processors",
              })}
            </Link>
            <Link to="/" className="hover:text-foreground hover:underline">
              {translate("crm.auth.back_to_home", { _: "Back to home" })}
            </Link>
          </nav>
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
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {translate("crm.auth.signup_privacy_note", {
                _: "Records are held per family. They are not shared with other families.",
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
            <Button
              type="button"
              className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
              disabled={isRequesting}
              onClick={handleContinue}
            >
              {translate("crm.auth.continue", { _: "Continue" })}
            </Button>
            {isGoogleOAuthEnabled() ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs uppercase text-muted-foreground">
                    {translate("crm.auth.login.or_divider", { _: "or" })}
                  </span>
                  <Separator className="flex-1" />
                </div>
                <GoogleSignUpButton redirect={redirectTo} />
              </div>
            ) : null}
            <AgeNotice />
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

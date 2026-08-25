import { useRef, useState } from "react";
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
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";
import { AgeNotice } from "./AgeNotice";
import { AuthLayout } from "./AuthLayout";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { isGoogleOAuthEnabled } from "./googleOAuth";
import { resolveAuthErrorNotification } from "./resolveAuthError";
import { TurnstileWidget, type TurnstileWidgetHandle } from "./TurnstileWidget";
import { TURNSTILE_SITE_KEY } from "./turnstileConfig";
import { isNoAccountFoundError } from "../providers/commons/authErrors";

type LoginStep = "email" | "code";

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
 * Also the ONLY entry point that renders `TurnstileWidget` on the sign-in
 * path: `requestCode()` forwards whatever `captchaToken` the widget has
 * solved so far on every `requestOtp` call (the initial send AND a resend).
 * Supabase's captcha gate is project-wide, not per-endpoint (see
 * `turnstileConfig.ts`), so sign-in has to already be sending a token before
 * `security_captcha_enabled` is ever flipped on — this never blocks the
 * "Send code" button on a solved token, though: `TurnstileWidget` degrades
 * to rendering nothing and reporting `null` if its script fails to load
 * (blocked by an extension, offline), and gating submission on a token that
 * can legitimately never arrive would trap a visitor on a form that can't
 * submit. `captchaToken` is simply whatever is currently held (possibly
 * `undefined`), same as `GoogleSignInButton` never needing one at all
 * (`signInWithOAuth()` isn't covered by the same captcha middleware).
 *
 * `TurnstileWidget` only mounts once the visitor has actually shown OTP
 * intent (focused the email field, tracked by `wantsOtp`) or already reached
 * the code step — never unconditionally on page load. A visitor who goes
 * straight for `GoogleSignInButton` never triggers Cloudflare's challenge
 * machinery on this page at all, which observably has its own flakiness
 * (double challenge sessions, its own internal verification calls
 * returning 401) that has nothing to do with — and must never be able to
 * interfere with — a click that doesn't need it. Once mounted (`wantsOtp`
 * never resets to `false`), it stays alive across a switch to the code step
 * and back, same as before, so a resend still reuses the same live widget
 * instance instead of re-solving a challenge the visitor already passed —
 * see `TurnstileWidget`'s own doc comment.
 *
 * Also renders `GoogleSignInButton` (only when `isGoogleOAuthEnabled()`)
 * and a link to `/register` (`RegisterFlow`) — the open self-service signup
 * path now that the invite gate is gone. Both were previously built but
 * wired into nothing; this is their entry point into the visible app.
 *
 * "Signing in never creates an account" still holds for the email path and
 * only for it: `shouldCreateUser` defaults to false, so an unknown address
 * gets `NoAccountFoundError` rather than a new user. It is no longer true
 * of `GoogleSignInButton` — `signInWithOAuth()` has no such switch, and the
 * `check_signup_age()` Auth Hook that used to 403 an unaffirmed OAuth
 * signup is retired. A visitor without an account who reaches for Google
 * here now gets one, which is why `AgeNotice` renders beside that button:
 * this is an account-creating surface, and every account-creating surface
 * has to say what creating an account affirms.
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
  const [isResending, setIsResending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [wantsOtp, setWantsOtp] = useState(false);
  const [noAccountFound, setNoAccountFound] = useState(false);
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
      captchaToken: captchaToken ?? undefined,
    });
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  };

  const handleRequestCode: SubmitHandler<FieldValues> = (values) => {
    const submittedEmail = String(values.email ?? "").trim();
    setNoAccountFound(false);
    setIsRequesting(true);
    requestCode(submittedEmail)
      .then(() => {
        setEmail(submittedEmail);
        setStep("code");
        // A Turnstile token is single-use — force a fresh one now that this
        // one has been consumed, so a resend on the code step (below) never
        // reuses an already-spent token.
        resetCaptcha();
      })
      .catch((error: unknown) => {
        resetCaptcha();
        if (isNoAccountFoundError(error)) {
          setNoAccountFound(true);
          return;
        }
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
    if (isResending) {
      return;
    }
    setIsResending(true);
    requestCode(email)
      .then(() => {
        notify("crm.auth.login.code_resent", {
          messageArgs: { _: "Code sent again" },
        });
        resetCaptcha();
      })
      .catch((error: unknown) => {
        resetCaptcha();
        if (isNoAccountFoundError(error)) {
          setStep("email");
          setNoAccountFound(true);
          return;
        }
        notifyError(error, {
          id: "ra.auth.sign_in_error",
          defaultMessage: "Authentication failed, please retry",
        });
      })
      .finally(() => setIsResending(false));
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
          {/* h1, not h2: this is the page's top-level heading. `AuthLayout`'s
              brand lockup is a plain span, so an h2 here left the document
              outline starting at level 2 with nothing above it. Every other
              auth screen already uses h1. */}
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.login.title", { _: "Welcome back" })}
          </h1>
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
          <div className="space-y-6">
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
                onFocus={() => setWantsOtp(true)}
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

            {noAccountFound ? (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm"
              >
                <p className="font-medium">
                  {translate("crm.auth.login.no_account_found", {
                    _: "No account has been found. Would you like to create a new account?",
                  })}
                </p>
                <Link
                  to="/register"
                  className="inline-flex font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {translate("crm.auth.login.create_new_account", {
                    _: "Create a new account",
                  })}
                </Link>
              </div>
            ) : null}

            {isGoogleOAuthEnabled() ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs uppercase text-muted-foreground">
                    {translate("crm.auth.login.or_divider", { _: "or" })}
                  </span>
                  <Separator className="flex-1" />
                </div>
                <GoogleSignInButton redirect={redirectTo} />
                <AgeNotice />
              </div>
            ) : null}

            <p className="text-center text-sm text-muted-foreground">
              {translate("crm.auth.login.no_account", {
                _: "Don't have an account?",
              })}{" "}
              <Link
                to="/register"
                className="font-medium text-foreground hover:underline"
              >
                {translate("crm.auth.login.create_account", {
                  _: "Create one",
                })}
              </Link>
            </p>
          </div>
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
                disabled={isResending}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {isResending ? (
                  <Loader2
                    className="me-1 inline size-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {translate("crm.auth.login.resend_code", {
                  _: "Resend code",
                })}
              </button>
            </div>
          </Form>
        )}

        {wantsOtp || step === "code" ? (
          <TurnstileWidget
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            onToken={setCaptchaToken}
          />
        ) : null}
      </div>
    </AuthLayout>
  );
};

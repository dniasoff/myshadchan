import { Loader2 } from "lucide-react";
import { Form, required, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

export interface OtpCodeStepProps {
  email: string;
  isVerifying: boolean;
  /** Whether a resend is in flight. Required, not optional: on a slow phone
   * connection an un-disabled "Resend code" looks inert, and every extra tap
   * sends another OTP until Supabase rate-limits the visitor out of their own
   * signup. A caller that has no resend state has to say so deliberately. */
  isResending: boolean;
  onSubmit: SubmitHandler<FieldValues>;
  onResend: () => void;
  /** Heading for this step. Defaults to the sign-in wording; RegisterFlow
   * passes its own, because greeting someone with "Welcome back" thirty
   * seconds after they created their account reads as a mistake. */
  title?: { id: string; defaultMessage: string };
  /** Omit to hide the "use a different email" link — RegisterFlow's email
   * is affirmed together with the age checkbox, so going back means
   * restarting the whole step, not just this one link (see RegisterFlow). */
  onUseDifferentEmail?: () => void;
}

/**
 * The 6-digit code verification step, shared by every OTP-based entry point
 * (LoginPage's sign-in, RegisterFlow's signup). Pulled out of LoginPage so
 * the two never drift into two slightly different "type your code" forms —
 * `verifyOtp()` itself needs no Turnstile token (see authProvider.ts), so
 * this step never has to know about captcha at all.
 */
export const OtpCodeStep = ({
  email,
  isVerifying,
  isResending,
  onSubmit,
  onResend,
  onUseDifferentEmail,
  title = { id: "crm.auth.login.title", defaultMessage: "Welcome back" },
}: OtpCodeStepProps) => {
  const translate = useTranslate();

  return (
    <div className="space-y-6">
      <div className="text-center">
        {/* h1: this step replaces its host's header entirely, so it is the
            page's top-level heading while it is mounted — an h2 left the
            outline starting at level 2 with nothing above it. */}
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {translate(title.id, { _: title.defaultMessage })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("crm.auth.login.code_sent_to", {
            email,
            _: "We sent a 6-digit code to %{email}.",
          })}
        </p>
      </div>

      <Form className="space-y-4" onSubmit={onSubmit}>
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
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {translate("ra.auth.sign_in")}
        </Button>
        <div
          className={cn(
            "flex items-center text-sm",
            onUseDifferentEmail ? "justify-between" : "justify-center",
          )}
        >
          {onUseDifferentEmail ? (
            <button
              type="button"
              onClick={onUseDifferentEmail}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {translate("crm.auth.login.use_different_email", {
                _: "Use a different email",
              })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onResend}
            disabled={isResending}
            className="text-muted-foreground hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isResending ? (
              <Loader2
                className="me-1 inline size-3 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {translate("crm.auth.login.resend_code", { _: "Resend code" })}
          </button>
        </div>
      </Form>
    </div>
  );
};

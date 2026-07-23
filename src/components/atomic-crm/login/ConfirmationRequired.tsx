import { Mail } from "lucide-react";
import { useTranslate } from "ra-core";
import { AuthLayout } from "./AuthLayout";

/**
 * Shown right after sign-up while the confirmation email is in flight.
 * Shares the auth cluster's ground + glass card (`AuthLayout`) so the whole
 * sign-up → confirm journey reads as one calm moment.
 */
export const ConfirmationRequired = () => {
  const translate = useTranslate();

  return (
    <AuthLayout>
      <div className="space-y-4 text-center">
        <div
          className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
          style={{
            background:
              "color-mix(in oklch, var(--primary) 14%, transparent)",
          }}
        >
          <Mail
            className="size-6"
            style={{ color: "var(--primary)" }}
            aria-hidden="true"
          />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.welcome_title", {
              _: "Welcome to MyShadchan",
            })}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {translate("crm.auth.confirmation_required", {
              _: "Please follow the link we just sent you by email to confirm your account.",
            })}
          </p>
        </div>

        <p className="text-xs text-muted-foreground/80">
          {translate("crm.auth.confirmation_required_hint", {
            _: "Didn't get it? Check your spam folder, or try signing up again in a moment.",
          })}
        </p>
      </div>
    </AuthLayout>
  );
};

ConfirmationRequired.path = "/sign-up/confirm";

import { Mail } from "lucide-react";
import { useTranslate } from "ra-core";
import { Notification } from "@/components/admin/notification";
import { LedgerMark } from "./AuthHero";

/**
 * Shown right after sign-up while the confirmation email is in flight.
 * Reskinned to match the auth cluster (Quiet Luminance): calm centered card,
 * LedgerMark instead of an inverted logo, no glass (reading surface).
 */
export const ConfirmationRequired = () => {
  const translate = useTranslate();

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      <div className="ql-enter mx-auto w-full max-w-sm space-y-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <div
            className="grid h-9 w-9 place-items-center rounded-lg text-primary-foreground"
            style={{ background: "var(--primary)" }}
          >
            <LedgerMark className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight">
            My<span style={{ color: "var(--primary)" }}>Shadchan</span>
          </span>
        </div>

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

      <Notification />
    </div>
  );
};

ConfirmationRequired.path = "/sign-up/confirm";

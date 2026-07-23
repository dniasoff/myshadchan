import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LedgerMark } from "./BrandLockup";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

export interface AgeAffirmationProps {
  /** Called once the user has checked the box and pressed Continue. */
  onContinue: () => void;
  /** Optional: render as a step inside a larger wizard (hides the brand mark). */
  compact?: boolean;
}

/**
 * First-run gate: a calm, single-question affirmation that the account
 * holder is an adult, before any family data is entered. There is no
 * `date_of_birth`/age column on `accounts` or `account_members` yet — this
 * is a UI shell only. Wiring it to persist an affirmation record (or block
 * signup server-side) is a backend gap for whoever routes onboarding.
 */
export const AgeAffirmation = ({
  onContinue,
  compact = false,
}: AgeAffirmationProps) => {
  const translate = useTranslate();
  const [affirmed, setAffirmed] = useState(false);

  // Compact mode is embedded inside a wizard that already owns the
  // full-screen container (see FirstRunSetup) — only wrap ourselves in the
  // washed page shell when rendered standalone (e.g. as its own route).
  const content = (
    <div className="ql-enter mx-auto w-full max-w-sm space-y-6 text-center">
      {compact ? null : (
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
      )}

      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
        style={{
          background: "color-mix(in oklch, var(--st-look) 16%, transparent)",
        }}
      >
        <ShieldCheck
          className="size-6"
          style={{ color: "var(--st-look)" }}
          aria-hidden="true"
        />
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {translate("crm.auth.age_affirmation.title", {
            _: "Before you begin",
          })}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {translate("crm.auth.age_affirmation.body", {
            _: "MyShadchan holds private, sensitive family records. It's built for parents and guardians managing the shidduchim process on behalf of their household.",
          })}
        </p>
      </div>

      <label
        htmlFor="age-affirmation-checkbox"
        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 text-start shadow-sm transition-colors duration-[160ms] hover:bg-secondary/50"
      >
        <Checkbox
          id="age-affirmation-checkbox"
          checked={affirmed}
          onCheckedChange={(checked) => setAffirmed(checked === true)}
          className="mt-0.5"
        />
        <span className="text-sm font-medium">
          {translate("crm.auth.age_affirmation.checkbox", {
            _: "I confirm I am 18 years of age or older.",
          })}
        </span>
      </label>

      <Button
        type="button"
        className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
        disabled={!affirmed}
        onClick={onContinue}
      >
        {translate("crm.auth.age_affirmation.continue", {
          _: "Continue",
        })}
      </Button>
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      {content}
    </div>
  );
};

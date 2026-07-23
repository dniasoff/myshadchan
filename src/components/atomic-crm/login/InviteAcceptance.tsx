import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { LedgerMark } from "./BrandLockup";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

export interface InviteAcceptanceProps {
  /** The invited email address (read-only — comes from the invite). */
  email: string;
  /** Display name of the account the invite belongs to, e.g. "The Klein family". */
  accountName?: string;
  /** Called with the chosen password once the form validates. */
  onAccept: (password: string) => void | Promise<void>;
  isSubmitting?: boolean;
}

/**
 * UI shell for accepting a household invite (e.g. a `helper` or
 * `self_manager` member added via `account_members.invited_by`). There is no
 * invite-token table/edge-function yet — no way to look up `email` /
 * `accountName` from a URL token, and `onAccept` has nothing to call. This
 * renders the intended flow; wiring a real invite-token endpoint is a
 * backend gap, not fabricated here.
 */
export const InviteAcceptance = ({
  email,
  accountName,
  onAccept,
  isSubmitting = false,
}: InviteAcceptanceProps) => {
  const translate = useTranslate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordsMatch =
    password.length >= 8 && password === confirmPassword;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordsMatch || isSubmitting) return;
    void onAccept(password);
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      <div className="ql-enter mx-auto w-full max-w-sm space-y-6">
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

        <div className="space-y-2 text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
            style={{
              background:
                "color-mix(in oklch, var(--violet) 16%, transparent)",
            }}
          >
            <UserPlus
              className="size-6"
              style={{ color: "var(--violet)" }}
              aria-hidden="true"
            />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.invite.title", { _: "You've been invited" })}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {accountName
              ? translate("crm.auth.invite.body_named", {
                  _: `Set a password to join ${accountName} on MyShadchan.`,
                  accountName,
                })
              : translate("crm.auth.invite.body", {
                  _: "Set a password to join this family's records on MyShadchan.",
                })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">
              {translate("ra.auth.email")}
            </Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              disabled
              readOnly
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-password">
              {translate("crm.auth.invite.password", {
                _: "Choose a password",
              })}
            </Label>
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-password-confirm">
              {translate("crm.auth.invite.password_confirm", {
                _: "Confirm password",
              })}
            </Label>
            <Input
              id="invite-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>

          <Button
            type="submit"
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={!passwordsMatch || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {translate("crm.auth.invite.accepting", { _: "Joining..." })}
              </>
            ) : (
              translate("crm.auth.invite.accept", { _: "Accept invite" })
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

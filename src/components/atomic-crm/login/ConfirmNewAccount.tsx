import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useLogout,
  useNotify,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import { AuthLayout } from "./AuthLayout";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

export interface ConfirmNewAccountProps {
  /** Called once the affirmation is recorded, so the gate can re-read it. */
  onConfirmed: () => void;
}

/**
 * The first thing a brand-new login sees: that an account now exists for
 * them, and the 18+ affirmation as an actual control.
 *
 * WHY THIS EXISTS, and why it is a screen rather than a hook. The affirmation
 * used to be a checkbox on the signup form whose state had to reach
 * `check_signup_age()` — the `before_user_created` Auth Hook — BEFORE the user
 * row existed. `signInWithOAuth()` can carry neither `user_metadata` nor any
 * other payload, so Google needed a `signup_intents` row keyed on an email we
 * had to make the visitor type first, for a button whose whole point is that
 * Google already knows who they are. 20260824122333 retired that mechanism,
 * correctly.
 *
 * What it left behind was a passive sentence and, with the hook gone, a
 * "Continue with Google" on `/login` that silently creates an account for a
 * visitor who does not have one. Measured on production: one click, provider
 * `["google"]`, `created_at == last_sign_in_at`, straight into the app —
 * never told an account was being created, never asked to affirm anything.
 * `/login`'s own "No account has been found. Would you like to create a new
 * account?" cannot reach that path: it fires on the email/OTP branch, where
 * `signInWithOtp({ shouldCreateUser: false })` can refuse, and by the time
 * Google redirects back the account already exists.
 *
 * Asking AFTER creation needs no channel at all — the caller is authenticated
 * by then, so `affirm_age()` is an ordinary RPC. That is the whole reason the
 * obstacle which killed the old design does not apply here, and it lets this
 * screen say the more important half out loud: an account has just been made.
 *
 * "Not now" signs out rather than deleting the login. Deleting would need a
 * destructive service-role path for a row that holds nothing — no account, no
 * persona, no data — and the honest outcome is the same either way: nothing is
 * set up, and the affirmation is asked again on the next sign-in, because
 * `age_affirmation_pending()` still reports true.
 */
export const ConfirmNewAccount = ({ onConfirmed }: ConfirmNewAccountProps) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const logout = useLogout();
  const { identity } = useGetIdentity();
  const [affirmed, setAffirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  // `handle_new_user()` falls back to "Pending" for both names when the
  // provider sent nothing usable, so a greeting is only shown when there is a
  // real name behind it.
  const name = identity?.fullName?.trim();
  const hasRealName = Boolean(name) && !/^Pending(\s+Pending)?$/.test(name!);

  const handleContinue = async () => {
    if (!affirmed || saving) return;
    setSaving(true);
    try {
      await dataProvider.affirmAge();
      onConfirmed();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your confirmation. Please try again.",
        { type: "error" },
      );
      setSaving(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.confirm_account.title", {
              _: "One thing before you start",
            })}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {hasRealName
              ? translate("crm.auth.confirm_account.body_named", {
                  name,
                  _: "%{name}, there was no account here yet — so signing in has just created one for you.",
                })
              : translate("crm.auth.confirm_account.body", {
                  _: "There was no account here yet — so signing in has just created one for you.",
                })}
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-4">
          <Checkbox
            id="age-affirmation"
            checked={affirmed}
            onCheckedChange={(checked) => setAffirmed(checked === true)}
            className="mt-0.5"
          />
          <Label
            htmlFor="age-affirmation"
            className="text-sm font-normal leading-relaxed"
          >
            {translate("crm.auth.confirm_account.age", {
              _: "I confirm that I am 18 years of age or older.",
            })}
          </Label>
        </div>

        <div className="space-y-3">
          {/* `w-full`, like every other primary action in this cluster: the
              "sign me out" button below it is full width, so without this the
              screen's destructive choice was the visually dominant one and
              Continue was a ~90px pill beside it. */}
          <Button
            type="button"
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={!affirmed || saving}
            onClick={handleContinue}
          >
            {saving ? (
              <Loader2
                className="me-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {translate("crm.auth.confirm_account.continue", {
              _: "Continue",
            })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={saving}
            onClick={() => logout()}
          >
            {translate("crm.auth.confirm_account.decline", {
              _: "Not now — sign me out",
            })}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};

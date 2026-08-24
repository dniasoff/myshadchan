import { useTranslate } from "ra-core";

/**
 * The 18+ affirmation, as a notice rather than a control.
 *
 * It used to be a checkbox (`AgeAffirmation`, removed) whose checked state
 * had to reach the server, which is what forced `RegisterFlow`'s Google
 * button to demand a typed email before redirecting: `signInWithOAuth()`
 * cannot carry `user_metadata`, so the only channel left was a
 * `signup_intents` row keyed on an email we had to know up front. Affirming
 * by the act of creating an account removes that channel requirement
 * entirely — nothing has to travel, so nothing has to be keyed, so Google
 * needs no email and no server-side gate exists to fail closed on.
 *
 * Render it ONCE per surface, below every control on that surface that can
 * create an account — the sentence is scoped to the act, not to one button,
 * so a screen offering both OTP and Google needs one notice, not two. Every
 * such surface needs it: `LoginPage` included, since with the
 * `before_user_created` hook retired its "Continue with Google" now creates
 * an account for a visitor who does not have one yet.
 */
export const AgeNotice = () => {
  const translate = useTranslate();

  return (
    <p className="text-center text-xs leading-relaxed text-muted-foreground">
      {translate("crm.auth.age_notice", {
        _: "By creating an account, you confirm you are 18 years of age or older.",
      })}
    </p>
  );
};

import { Button } from "@/components/ui/button";
import { LandingBrand } from "./LandingBrand";
import { REGISTER_PATH, SIGN_IN_PATH } from "./landingLinks";
import { translateLanding } from "./landingTranslate";

/**
 * Footer legal links. `hover:underline` alone is a state that does not exist
 * on a touch device, so on a phone these read as plain grey caption text with
 * nothing to say they are tappable — and at ~20px tall they were well under
 * the 44px touch minimum. The underline is therefore permanent (dimmed, so it
 * still reads as secondary) and the row is a real target.
 */
const FOOTER_LINK_CLASSNAME =
  "inline-flex min-h-11 items-center underline underline-offset-4 " +
  "decoration-muted-foreground/40 hover:text-foreground hover:decoration-current";

/**
 * Two intents, two weights: a visitor who already knows they want to sign in
 * gets the solid button, same as before this pair existed; "Create an
 * account" sits beside it in the quieter ghost treatment, since the header's
 * job is navigation for someone who already knows what they want, not
 * persuasion — that is the hero's job.
 *
 * On a phone only "Sign in" survives, and that follows from the same
 * sentence. Brand plus both buttons needs roughly 440px of a 360px screen, so
 * the row overflowed: "Create an account" filled the width and "Sign in" was
 * clipped off the right edge. Dropping the persuasion button is the correct
 * half to lose, because the hero directly below carries "Create an account"
 * as its full-size primary action — the header is not the only door, and on a
 * phone it is not even the first one the eye reaches.
 */
export const LandingHeader = () => (
  <header className="relative px-4 py-4 sm:px-8 sm:py-6">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
      <LandingBrand />
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="hidden h-10 px-4 sm:inline-flex"
        >
          <a href={REGISTER_PATH}>
            {translateLanding(
              "crm.landing.nav.create_account",
              "Create an account",
            )}
          </a>
        </Button>
        <Button asChild size="sm" className="h-10 px-5 shadow-xs">
          <a href={SIGN_IN_PATH}>
            {translateLanding("crm.landing.nav.sign_in", "Sign in")}
          </a>
        </Button>
      </div>
    </div>
  </header>
);

export const LandingFooter = () => (
  <footer className="border-t px-6 py-10 sm:px-8">
    <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <LandingBrand size="sm" />
      <p className="text-sm text-muted-foreground">
        {translateLanding(
          "crm.landing.footer.note",
          "The code is public. The record is free; the optional AI features are paid. Run at cost.",
        )}
      </p>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <a href="/terms" className={FOOTER_LINK_CLASSNAME}>
          {translateLanding("crm.landing.footer.terms", "Terms of Service")}
        </a>
        <a href="/privacy" className={FOOTER_LINK_CLASSNAME}>
          {translateLanding("crm.landing.footer.privacy", "Privacy Policy")}
        </a>
        <a href="/sub-processors" className={FOOTER_LINK_CLASSNAME}>
          {translateLanding(
            "crm.landing.footer.subprocessors",
            "Sub-processors",
          )}
        </a>
      </nav>
    </div>
  </footer>
);

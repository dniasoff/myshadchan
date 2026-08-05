import { Button } from "@/components/ui/button";
import { LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { REGISTER_PATH, SIGN_IN_PATH } from "./landingLinks";
import { translateLanding } from "./landingTranslate";

/**
 * The page ends on one full-bleed dark slab carrying the closing actions. It is
 * the darkest block on the page in both themes and the tallest, so the heading
 * accent and the plain statement above it read the same way either way round —
 * and the last thing on the page is also the most emphatic. "Create an
 * account" gets the primary treatment used by the header and hero — the lead
 * sentence right above it already says accounts are made with an email
 * address, so the button that follows is the one that does that; "Sign in"
 * stays reachable, one step quieter, for a visitor who is already a member.
 * Honey is the pipeline's attention token, not a call to action.
 */
export const LandingClosing = () => (
  <LandingSection
    id="closing"
    className="bg-landing-band py-28 text-landing-band-foreground sm:py-40"
  >
    <div className="flex flex-col items-start gap-12 lg:flex-row lg:items-end lg:justify-between lg:gap-20">
      <LandingHeading
        sectionId="closing"
        lead={translateLanding("crm.landing.closing.title_lead", "Create")}
        accent={translateLanding(
          "crm.landing.closing.title_accent",
          "your record.",
        )}
        accentClassName="text-landing-accent-hi"
        className="mt-0 max-w-2xl sm:text-[3.5rem]"
      />

      <div className="shrink-0 lg:pb-2">
        <p className="text-lg text-landing-band-foreground/70">
          {translateLanding(
            "crm.landing.closing.lead",
            "Accounts are created with an email address.",
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-12 px-7 text-base shadow-sm">
            <a href={REGISTER_PATH}>
              {translateLanding("crm.landing.closing.cta", "Create an account")}
            </a>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 border-landing-band-foreground/30 bg-transparent px-7 text-base text-landing-band-foreground hover:bg-landing-band-foreground/10 hover:text-landing-band-foreground dark:border-landing-band-foreground/30 dark:bg-transparent dark:hover:bg-landing-band-foreground/10"
          >
            <a href={SIGN_IN_PATH}>
              {translateLanding("crm.landing.closing.cta_secondary", "Sign in")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  </LandingSection>
);

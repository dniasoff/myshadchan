import { Button } from "@/components/ui/button";
import { LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { SIGN_IN_PATH } from "./landingLinks";
import { translateLanding } from "./landingTranslate";

/**
 * The page ends on one full-bleed dark slab carrying the single action. It is
 * the darkest block on the page in both themes and the tallest, so the heading
 * accent and the plain statement above it read the same way either way round —
 * and the last thing on the page is also the most emphatic. The button keeps
 * the primary treatment used by the header and hero: honey is the pipeline's
 * attention token, not a call to action.
 */
export const LandingClosing = () => (
  <LandingSection
    id="closing"
    className="bg-landing-band py-28 text-landing-band-foreground sm:py-40"
  >
    <div className="flex flex-col items-start gap-12 lg:flex-row lg:items-end lg:justify-between lg:gap-20">
      <LandingHeading
        sectionId="closing"
        lead={translateLanding("crm.landing.closing.title_lead", "Sign in")}
        accent={translateLanding(
          "crm.landing.closing.title_accent",
          "to the record.",
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
        <Button
          asChild
          size="lg"
          className="mt-5 h-12 px-7 text-base shadow-sm"
        >
          <a href={SIGN_IN_PATH}>
            {translateLanding("crm.landing.closing.cta", "Sign in")}
          </a>
        </Button>
      </div>
    </div>
  </LandingSection>
);

import { Code, Scale } from "lucide-react";
import { LandingEyebrow, LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { translateLanding } from "./landingTranslate";

/**
 * The two facts about the project itself, as a pair of cards: the plain one
 * carries the code, the tinted one the cost.
 */
export const LandingOpenness = () => (
  <LandingSection id="openness" className="border-t bg-card">
    <LandingEyebrow>
      {translateLanding("crm.landing.openness.eyebrow", "Code and cost")}
    </LandingEyebrow>
    <LandingHeading
      sectionId="openness"
      lead={translateLanding(
        "crm.landing.openness.title_lead",
        "The code is public.",
      )}
      accent={translateLanding(
        "crm.landing.openness.title_accent",
        "The service is free.",
      )}
    />

    <div className="mt-12 grid gap-5 sm:grid-cols-2">
      <article className="rounded-2xl border bg-background p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary text-foreground">
          <Code className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-5 font-display text-xl font-bold tracking-tight">
          {translateLanding("crm.landing.openness.code.title", "Code")}
        </h3>
        <p className="mt-2.5 leading-relaxed text-muted-foreground text-pretty">
          {translateLanding(
            "crm.landing.openness.code.body",
            "The code is public. It can be read, audited and self-hosted, and becomes fully open source two years after each release.",
          )}
        </p>
      </article>

      <article className="rounded-2xl border-2 border-landing-line bg-landing-tint p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-landing-accent-hi text-landing-accent-ink">
          <Scale className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-5 font-display text-xl font-bold tracking-tight">
          {translateLanding("crm.landing.openness.cost.title", "Cost")}
        </h3>
        <p className="mt-2.5 leading-relaxed text-foreground/80 text-pretty">
          {translateLanding(
            "crm.landing.openness.cost.body",
            "The service is free. It is run at cost, not for profit.",
          )}
        </p>
      </article>
    </div>
  </LandingSection>
);

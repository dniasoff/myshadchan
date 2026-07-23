import { Button } from "@/components/ui/button";
import { LandingEyebrow } from "./LandingHeading";
import { LandingStatesCard } from "./LandingStatesCard";
import { SIGN_IN_PATH, WHAT_ANCHOR } from "./landingLinks";
import { translateLanding } from "./landingTranslate";

export const LandingHero = () => (
  <section
    aria-labelledby="hero-title"
    className="relative px-6 pb-10 pt-10 sm:px-8 sm:pb-12 sm:pt-14"
  >
    <div className="relative mx-auto grid w-full max-w-6xl gap-14 duration-700 ease-out animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none lg:grid-cols-12 lg:items-end lg:gap-16">
      <div className="lg:col-span-7">
        <LandingEyebrow>
          {translateLanding("crm.landing.hero.eyebrow", "Shidduchim record")}
        </LandingEyebrow>

        <h1
          id="hero-title"
          className="mt-5 font-display text-[2.6rem] font-bold leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-[4.25rem]"
        >
          {translateLanding(
            "crm.landing.hero.title_lead",
            "A record of the shidduch process",
          )}{" "}
          <span className="text-landing-accent">
            {translateLanding(
              "crm.landing.hero.title_accent",
              "for your children.",
            )}
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground text-balance">
          {translateLanding(
            "crm.landing.hero.lead",
            "Suggestions, shadchanim, reference calls and dates, kept in one place.",
          )}
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-12 px-7 text-base shadow-sm">
            <a href={SIGN_IN_PATH}>
              {translateLanding("crm.landing.hero.cta", "Sign in")}
            </a>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-7 text-base"
          >
            <a href={WHAT_ANCHOR}>
              {translateLanding(
                "crm.landing.hero.cta_secondary",
                "What it does",
              )}
            </a>
          </Button>
        </div>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
          {translateLanding(
            "crm.landing.hero.note",
            "Records are held per family. They are not shared with other families.",
          )}
        </p>
      </div>

      <div className="max-w-md lg:col-span-5 lg:max-w-none">
        <LandingStatesCard />
      </div>
    </div>
  </section>
);

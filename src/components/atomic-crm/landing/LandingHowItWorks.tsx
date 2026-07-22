import { LandingEyebrow, LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { translateLanding } from "./landingTranslate";

interface Step {
  key: string;
  title: string;
  body: string;
}

const steps = (): Step[] => [
  {
    key: "enter",
    title: translateLanding("crm.landing.how.enter.title", "Enter the resume"),
    body: translateLanding(
      "crm.landing.how.enter.body",
      "A resume is entered against a child. If that name has been suggested before, the earlier suggestion is shown at that point.",
    ),
  },
  {
    key: "record",
    title: translateLanding(
      "crm.landing.how.record.title",
      "Record what happens",
    ),
    body: translateLanding(
      "crm.landing.how.record.body",
      "Reference calls, notes and dates are added to the suggestion as they take place.",
    ),
  },
  {
    key: "state",
    title: translateLanding("crm.landing.how.state.title", "Set the state"),
    body: translateLanding(
      "crm.landing.how.state.body",
      "The suggestion moves between the seven states until a decision is recorded.",
    ),
  },
];

export const LandingHowItWorks = () => (
  <LandingSection id="how" className="border-y bg-card">
    <LandingEyebrow>
      {translateLanding("crm.landing.how.eyebrow", "How it works")}
    </LandingEyebrow>
    <LandingHeading
      sectionId="how"
      lead={translateLanding("crm.landing.how.title_lead", "Three steps,")}
      accent={translateLanding(
        "crm.landing.how.title_accent",
        "from a resume to a decision.",
      )}
    />

    <ol className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
      {steps().map((step, index) => (
        <li key={step.key} className="border-t-2 border-landing-line pt-6">
          <p className="font-display text-4xl font-bold tabular-nums leading-none text-landing-accent">
            {String(index + 1).padStart(2, "0")}
          </p>
          <h3 className="mt-5 font-display text-xl font-bold tracking-tight">
            {step.title}
          </h3>
          <p className="mt-2.5 leading-relaxed text-muted-foreground text-pretty">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  </LandingSection>
);

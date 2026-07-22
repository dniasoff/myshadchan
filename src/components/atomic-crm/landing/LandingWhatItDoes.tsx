import type { LucideIcon } from "lucide-react";
import { Columns3, FileText, PhoneCall, RotateCcw } from "lucide-react";
import { LandingEyebrow, LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { translateLanding } from "./landingTranslate";

interface Capability {
  key: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const capabilities = (): Capability[] => [
  {
    key: "resumes",
    icon: FileText,
    title: translateLanding("crm.landing.what.resumes.title", "Resumes"),
    body: translateLanding(
      "crm.landing.what.resumes.body",
      "Resumes arrive by message, email, photo, or on paper and scanned in. Each is stored and filed against the child it was suggested for.",
    ),
  },
  {
    key: "repeats",
    icon: RotateCcw,
    title: translateLanding(
      "crm.landing.what.repeats.title",
      "Repeat suggestions",
    ),
    body: translateLanding(
      "crm.landing.what.repeats.body",
      "When a name is entered that has been suggested before, the earlier suggestion and the decision are shown.",
    ),
  },
  {
    key: "references",
    icon: PhoneCall,
    title: translateLanding(
      "crm.landing.what.references.title",
      "Reference calls",
    ),
    body: translateLanding(
      "crm.landing.what.references.body",
      "Each reference call records who was spoken to, what they said, and which questions have not been asked.",
    ),
  },
  {
    key: "status",
    icon: Columns3,
    title: translateLanding("crm.landing.what.status.title", "Status"),
    body: translateLanding(
      "crm.landing.what.status.body",
      "Each suggestion has one of seven states, from new through to a decision.",
    ),
  },
];

const CapabilityCard = ({
  icon: Icon,
  title,
  body,
}: Omit<Capability, "key">) => (
  <article className="rounded-2xl border bg-card p-7 shadow-sm transition-shadow hover:shadow-md sm:p-8">
    <span className="grid h-11 w-11 place-items-center rounded-xl border border-landing-line bg-landing-tint text-landing-accent">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
    <h3 className="mt-5 font-display text-xl font-bold tracking-tight">
      {title}
    </h3>
    <p className="mt-2.5 leading-relaxed text-muted-foreground text-pretty">
      {body}
    </p>
  </article>
);

export const LandingWhatItDoes = () => (
  // The hero shares this section's background, so the two are separated by one
  // step of the spacing rhythm rather than the full gap between two surfaces.
  <LandingSection id="what" className="pt-10 sm:pt-12">
    <div id="what" className="scroll-mt-24">
      <LandingEyebrow>
        {translateLanding("crm.landing.what.eyebrow", "What it does")}
      </LandingEyebrow>
      <LandingHeading
        sectionId="what"
        lead={translateLanding(
          "crm.landing.what.title_lead",
          "The software stores",
        )}
        accent={translateLanding(
          "crm.landing.what.title_accent",
          "resumes, calls, dates and decisions.",
        )}
      />
    </div>

    <div className="mt-12 grid gap-5 sm:grid-cols-2">
      {capabilities().map(({ key, ...capability }) => (
        <CapabilityCard key={key} {...capability} />
      ))}
    </div>
  </LandingSection>
);

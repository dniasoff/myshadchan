import type { LucideIcon } from "lucide-react";
import { Download, EyeOff, Users } from "lucide-react";
import { LandingEyebrow, LandingHeading } from "./LandingHeading";
import { LandingSection } from "./LandingSection";
import { translateLanding } from "./landingTranslate";

interface Assurance {
  key: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const assurances = (): Assurance[] => [
  {
    key: "pooled",
    icon: Users,
    title: translateLanding("crm.landing.privacy.pooled.title", "Not pooled"),
    body: translateLanding(
      "crm.landing.privacy.pooled.body",
      "Records are held per family. They are not pooled with other families, and they are not used to suggest anything to anyone else.",
    ),
  },
  {
    key: "directory",
    icon: EyeOff,
    title: translateLanding(
      "crm.landing.privacy.directory.title",
      "No directory",
    ),
    body: translateLanding(
      "crm.landing.privacy.directory.body",
      "There is no public directory. No one can look a family up.",
    ),
  },
  {
    key: "export",
    icon: Download,
    title: translateLanding(
      "crm.landing.privacy.export.title",
      "Export and deletion",
    ),
    body: translateLanding(
      "crm.landing.privacy.export.body",
      "All data can be exported or deleted at any time.",
    ),
  },
];

/** What the software does and does not do with the records it holds. */
export const LandingPrivacy = () => (
  <LandingSection id="privacy">
    <LandingEyebrow>
      {translateLanding("crm.landing.privacy.eyebrow", "Your data")}
    </LandingEyebrow>
    <LandingHeading
      sectionId="privacy"
      lead={translateLanding(
        "crm.landing.privacy.title_lead",
        "Records are stored",
      )}
      accent={translateLanding(
        "crm.landing.privacy.title_accent",
        "per family.",
      )}
    />

    <dl className="mt-12 grid gap-5 sm:grid-cols-3">
      {assurances().map(({ key, icon: Icon, title, body }) => (
        <div key={key} className="rounded-2xl border bg-card p-7 shadow-sm">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-landing-line bg-landing-tint text-landing-accent">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <dt className="mt-5 font-display text-xl font-bold tracking-tight">
            {title}
          </dt>
          <dd className="mt-2.5 leading-relaxed text-muted-foreground text-pretty">
            {body}
          </dd>
        </div>
      ))}
    </dl>
  </LandingSection>
);

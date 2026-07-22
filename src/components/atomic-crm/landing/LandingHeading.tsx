import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { landingHeadingId } from "./landingLinks";

interface LandingEyebrowProps {
  children: ReactNode;
  className?: string;
}

/** The small uppercase label that opens every section. */
export const LandingEyebrow = ({
  children,
  className,
}: LandingEyebrowProps) => (
  <p
    className={cn(
      "text-xs font-semibold uppercase tracking-[0.18em] text-landing-accent",
      className,
    )}
  >
    {children}
  </p>
);

interface LandingHeadingProps {
  /** Section slug — the heading carries `<slug>-title`, which labels the section. */
  sectionId: string;
  /** The part of the sentence set in the foreground colour. */
  lead: string;
  /** The part set in the accent colour. Rendered on its own line at width. */
  accent?: string;
  /** Overrides the accent colour — the dark band needs the lifted honey. */
  accentClassName?: string;
  className?: string;
}

/**
 * A section headline: display face, one size below the hero, with the second
 * half of the sentence carried in the accent colour.
 */
export const LandingHeading = ({
  sectionId,
  lead,
  accent,
  accentClassName,
  className,
}: LandingHeadingProps) => (
  <h2
    id={landingHeadingId(sectionId)}
    className={cn(
      "mt-4 max-w-3xl font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-balance sm:text-[2.75rem]",
      className,
    )}
  >
    {lead}
    {accent ? (
      <>
        {" "}
        <span className={cn("text-landing-accent", accentClassName)}>
          {accent}
        </span>
      </>
    ) : null}
  </h2>
);

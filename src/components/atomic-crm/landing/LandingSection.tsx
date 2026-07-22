import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { landingHeadingId } from "./landingLinks";

interface LandingSectionProps {
  /** Slug used to tie the section to its heading for screen readers. */
  id: string;
  className?: string;
  children: ReactNode;
}

/**
 * One chapter of the landing page: the shared horizontal measure and the
 * vertical rhythm every section repeats — eyebrow, headline, cards.
 */
export const LandingSection = ({
  id,
  className,
  children,
}: LandingSectionProps) => (
  <section
    aria-labelledby={landingHeadingId(id)}
    className={cn("px-6 py-20 sm:px-8 sm:py-24", className)}
  >
    <div className="mx-auto w-full max-w-6xl">{children}</div>
  </section>
);

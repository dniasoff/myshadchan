import { cn } from "@/lib/utils";

export const LedgerMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? "h-5 w-5"}
    aria-hidden="true"
  >
    <path d="M4 4h11a2 2 0 0 1 2 2v14l-4-2.5L9 20V6a2 2 0 0 0-2-2z" />
    <path d="M17 6h3v11" />
  </svg>
);

export interface BrandLockupProps {
  className?: string;
}

/**
 * The mark + wordmark lockup shared by every auth screen (login, signup,
 * forgot/set-password, confirmation, onboarding) and the landing page's own
 * `LandingBrand`. Single stable home for `LedgerMark` now that the retired
 * `AuthHero` split-panel no longer owns it.
 */
export const BrandLockup = ({ className }: BrandLockupProps) => (
  <div className={cn("flex items-center gap-2", className)}>
    <div
      className="grid h-9 w-9 place-items-center rounded-lg text-primary-foreground"
      style={{ background: "var(--primary)" }}
    >
      <LedgerMark className="h-5 w-5" />
    </div>
    <span className="font-display text-lg font-bold tracking-tight">
      My<span style={{ color: "var(--primary)" }}>Shadchan</span>
    </span>
  </div>
);

import { cn } from "@/lib/utils";
import { LedgerMark } from "../login/BrandLockup";

interface LandingBrandProps {
  /** `md` for the page header, `sm` for the footer. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * The MyShadchan wordmark: the ledger mark in an indigo tile, followed by the
 * name. Matches the compact brand already used on the sign-in page.
 */
export const LandingBrand = ({ size = "md", className }: LandingBrandProps) => (
  <span className={cn("inline-flex items-center gap-2.5", className)}>
    <span
      className={cn(
        "grid place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs",
        size === "md" ? "h-10 w-10" : "h-8 w-8",
      )}
    >
      <LedgerMark className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
    </span>
    <span
      className={cn(
        "font-display font-bold tracking-tight",
        size === "md" ? "text-xl" : "text-base",
      )}
    >
      My<span className="text-primary">Shadchan</span>
    </span>
  </span>
);

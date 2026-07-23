/**
 * Signature gradient CTA recipe (design-language.md §5.3) — indigo→violet
 * fill + accent-glow halo. One primary action per screen; everything else
 * stays flat/ghost. Shared across the auth + onboarding screens in this
 * lane so every "Continue" / "Sign in" / "Create account" reads as the
 * same premium action, matching the Foundation dashboard.
 */
export const PRIMARY_CTA_CLASSNAME =
  "text-primary-foreground " +
  "bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))] " +
  "shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)] " +
  "transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring] " +
  "hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)] " +
  "active:scale-[0.97] " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background outline-none";

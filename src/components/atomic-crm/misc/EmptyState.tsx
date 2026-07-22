import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  /** Inline SVG illustration; falls back to a calm open-ledger motif. */
  icon?: ReactNode;
  className?: string;
}

/** A simple line-art open-ledger motif — never emoji (design-language §5.7). */
const DefaultLedgerIcon = () => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-14"
    aria-hidden="true"
  >
    <path d="M32 14c-5-4-13-5-20-3v34c7-2 15-1 20 3 5-4 13-5 20-3V11c-7-2-15-1-20 3Z" />
    <path d="M32 14v34" />
    <path d="M16 20h8M16 28h8M40 20h8M40 28h8" />
  </svg>
);

/**
 * Warm, centered, one-action empty state (design-language §5.7): an inline
 * SVG illustration, a one-line reassurance, and — when there's somewhere
 * useful to go — a single primary button.
 */
export const EmptyState = ({
  title,
  description,
  actionLabel,
  actionTo,
  icon,
  className,
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 py-16 text-center",
      className,
    )}
  >
    <div className="text-muted-foreground/45">
      {icon ?? <DefaultLedgerIcon />}
    </div>
    <h2 className="font-display text-lg font-semibold">{title}</h2>
    <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    {actionLabel && actionTo ? (
      <Link
        to={actionTo}
        className="mt-2 inline-flex h-11 items-center gap-2 rounded-xl px-4
          font-semibold text-primary-foreground
          bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
          shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
          transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
          hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
          active:scale-[0.97]
          focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          focus-visible:ring-offset-background outline-none"
      >
        {actionLabel}
      </Link>
    ) : null}
  </div>
);

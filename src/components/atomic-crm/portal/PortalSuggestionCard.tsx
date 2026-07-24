import type { ChildPortalSuggestion } from "../types";

/** Format a YYYY-MM-DD redt date as "24 Jul 2026" (timezone-safe, calm). */
const formatRedt = (dateString?: string | null): string | null => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

interface PortalSuggestionCardProps {
  suggestion: ChildPortalSuggestion;
}

/**
 * One calm, read-only suggestion card. Renders ONLY the child-safe fields the RPC
 * returns — the prospect's name, a soft status label, and the redt date. All
 * text is rendered as text (React escapes it), never as HTML.
 */
export const PortalSuggestionCard = ({
  suggestion,
}: PortalSuggestionCardProps) => {
  const nameEn = suggestion.name_en?.trim() || null;
  const nameHe = suggestion.name_he?.trim() || null;
  const primaryName = nameEn ?? nameHe ?? "A suggestion";
  const redt = formatRedt(suggestion.redt_date);

  return (
    <article
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-card-foreground">
            {primaryName}
          </h2>
          {nameEn && nameHe ? (
            <p
              dir="rtl"
              lang="he"
              className="mt-0.5 text-sm text-muted-foreground"
              style={{ fontFamily: "var(--font-hebrew)" }}
            >
              {nameHe}
            </p>
          ) : null}
        </div>
        {suggestion.status_label ? (
          <span
            className="inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-semibold"
            style={{
              color:
                "color-mix(in oklch, var(--primary) var(--chip-text-mix, 70%), black)",
              backgroundColor:
                "color-mix(in oklch, var(--primary) 12%, transparent)",
              boxShadow:
                "inset 0 0 0 1px color-mix(in oklch, var(--primary) 24%, transparent)",
            }}
          >
            {suggestion.status_label}
          </span>
        ) : null}
      </div>
      {redt ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Brought up on {redt}
        </p>
      ) : null}
    </article>
  );
};

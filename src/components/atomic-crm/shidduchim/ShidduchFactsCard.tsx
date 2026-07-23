import type { ShidduchSummary } from "../types";

/**
 * One bilingual (or plain) fact row. Age/height are info-only (FR11) — they
 * render exactly like any other fact and are never framed as a matching
 * signal.
 */
const FactRow = ({
  label,
  en,
  he,
  plain,
}: {
  label: string;
  en?: string | null;
  he?: string | null;
  plain?: string | null;
}) => {
  if (!en && !he && !plain) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
        {plain ? <span>{plain}</span> : null}
        {en ? <span>{en}</span> : null}
        {he ? (
          <span className="font-hebrew text-muted-foreground" dir="rtl">
            {he}
          </span>
        ) : null}
      </dd>
    </div>
  );
};

/** The suggestion facts section (Screen 18 body) — parents, seminary, shul,
 * location, age, height in an elegant token-styled grid. */
export const ShidduchFactsCard = ({
  shidduch,
}: {
  shidduch: ShidduchSummary;
}) => {
  const hasAnyFact =
    Boolean(shidduch.parents_en) ||
    Boolean(shidduch.parents_he) ||
    Boolean(shidduch.seminary_en) ||
    Boolean(shidduch.seminary_he) ||
    Boolean(shidduch.shul_en) ||
    Boolean(shidduch.shul_he) ||
    Boolean(shidduch.location_en) ||
    Boolean(shidduch.location_he) ||
    shidduch.age != null ||
    Boolean(shidduch.height);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 font-display text-lg font-semibold">
        Suggestion facts
      </h3>
      {hasAnyFact ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <FactRow
            label="Parents"
            en={shidduch.parents_en}
            he={shidduch.parents_he}
          />
          <FactRow
            label="Seminary"
            en={shidduch.seminary_en}
            he={shidduch.seminary_he}
          />
          <FactRow label="Shul" en={shidduch.shul_en} he={shidduch.shul_he} />
          <FactRow
            label="Location"
            en={shidduch.location_en}
            he={shidduch.location_he}
          />
          <FactRow
            label="Age"
            plain={shidduch.age != null ? String(shidduch.age) : null}
          />
          <FactRow label="Height" plain={shidduch.height ?? null} />
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No details on file yet.
        </p>
      )}
    </section>
  );
};

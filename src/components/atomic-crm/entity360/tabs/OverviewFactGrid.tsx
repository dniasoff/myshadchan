import type { ReactElement } from "react";

/**
 * One bilingual (or plain) fact row. `label` is already translated by the
 * caller — this component does no i18n of its own. Age/height-style
 * info-only facts render exactly like any other fact.
 */
export type OverviewFact = {
  label: string;
  en?: string | null;
  he?: string | null;
  plain?: string | null;
};

/**
 * `ShidduchFactsCard.tsx`'s original `FactRow`, generalised and otherwise
 * unchanged: same classes, same `dir="rtl"` Hebrew handling, same
 * null-return for a value-less fact (renders nothing, not an empty row).
 */
const FactRow = ({ label, en, he, plain }: OverviewFact) => {
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

/**
 * The shared bilingual fact list every entity's Overview composes from
 * (contract §12 step 0). A fact with no `en`, `he` or `plain` renders
 * nothing; when every fact is empty, `emptyLabel` renders instead of the
 * `<dl>` (UX-DR11 empty state).
 */
export function OverviewFactGrid(props: {
  facts: OverviewFact[];
  emptyLabel: string;
}): ReactElement {
  const { facts, emptyLabel } = props;
  const hasAnyFact = facts.some((fact) => fact.en || fact.he || fact.plain);

  if (!hasAnyFact) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    // Mobile-first, deliberately: this used to start at `grid-cols-2` with an
    // `sm:` step UP and no step down, so a 360px phone got two ~152px columns
    // on the landing tab of every record. A `dd` here is an English value and
    // its `dir="rtl"` Hebrew on one baseline row (see `FactRow`), which at
    // 152px wraps to three or four lines each. One column at phone width is
    // what lets the pair sit on the single row it was designed for.
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact, index) => (
        <FactRow key={`${fact.label}-${index}`} {...fact} />
      ))}
    </dl>
  );
}

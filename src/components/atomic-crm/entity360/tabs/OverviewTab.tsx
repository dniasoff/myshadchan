import type { ReactElement, ReactNode } from "react";
import { useTranslate } from "ra-core";

import { OverviewFactGrid, type OverviewFact } from "./OverviewFactGrid";

/**
 * The tab-level wrapper every entity's Overview composes from: the shared
 * fact grid followed by the entity-specific sections passed as `children`
 * (`ShidduchSchoolsSection` / `ShidduchCatchSection` for 5.1, the
 * `singles_summary` block for 5.8, and so on).
 *
 * An entity whose Overview is entirely custom sections is not "empty" —
 * when no fact carries a value (whether `facts` is `[]` or every entry is
 * value-less) AND `children` are given, the fact grid (and its own
 * empty-state message) is skipped entirely so the generic "no details"
 * copy never shadows real content. Whenever there are no `children` to
 * fall back on, the grid always renders — including its own empty-state
 * branch when every fact is value-less — so the tab is never left blank
 * with no UX-DR11 empty state at all.
 */
export function OverviewTab(props: {
  facts: OverviewFact[];
  emptyLabel?: string;
  children?: ReactNode;
}): ReactElement {
  const { facts, emptyLabel, children } = props;
  const translate = useTranslate();
  const resolvedEmptyLabel =
    emptyLabel ??
    translate("crm.entity360.overview.empty", {
      _: "No details on file yet.",
    });
  const hasFactValue = facts.some((fact) => fact.en || fact.he || fact.plain);
  const showGrid = hasFactValue || !children;

  return (
    <div className="flex flex-col gap-6">
      {showGrid ? (
        <OverviewFactGrid facts={facts} emptyLabel={resolvedEmptyLabel} />
      ) : null}
      {children}
    </div>
  );
}

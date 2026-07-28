import type { ReactElement, ReactNode } from "react";
import { useTranslate } from "ra-core";

import { OverviewFactGrid, type OverviewFact } from "./OverviewFactGrid";

/**
 * The tab-level wrapper every entity's Overview composes from: the shared
 * fact grid followed by the entity-specific sections passed as `children`
 * (`ShidduchSchoolsSection` / `ShidduchCatchSection` for 5.1, the
 * `singles_summary` block for 5.8, and so on).
 *
 * An entity whose Overview is entirely custom sections (`facts: []`) is not
 * "empty" — when `facts` is empty AND `children` are given, the fact grid
 * (and its own empty-state message) is skipped entirely so the generic
 * "no details" copy never shadows real content. A non-empty `facts` array
 * always renders through `OverviewFactGrid`, including its own empty-state
 * branch when every fact in it happens to be value-less.
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

  return (
    <div className="flex flex-col gap-6">
      {facts.length > 0 ? (
        <OverviewFactGrid facts={facts} emptyLabel={resolvedEmptyLabel} />
      ) : null}
      {children}
    </div>
  );
}

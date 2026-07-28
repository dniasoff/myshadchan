import type { ReactElement, ReactNode } from "react";

/**
 * The one 360 shell every entity renders through (AD-24). Seven fixed,
 * optional regions, always in this order — breadcrumb, identity header, stat
 * band, alert slot, tab bar, content, right rail. A consumer that wants
 * different spacing or ordering edits this file for every entity, or does
 * not get it: there is no `className`, no `style`, no order/variant prop.
 */
export interface Entity360Props {
  /** Reserved (AD-24). No consumer in Epics 4-11 today — keep it, do not
   * repurpose it and do not delete it. */
  breadcrumb?: ReactNode;
  identityHeader?: ReactNode;
  /**
   * Compose from `DashboardStat` tiles
   * (`src/components/atomic-crm/dashboard/DashboardStat.tsx`). The shell
   * neither fetches nor formats stats — the entity's descriptor module owns
   * that (Epic 3 API contract §2 rule 1).
   */
  statBand?: ReactNode;
  /**
   * Compose from `Alert` / `AlertTitle` / `AlertDescription`
   * (`src/components/ui/alert.tsx`).
   */
  alertSlot?: ReactNode;
  tabBar?: ReactNode;
  /** Tab content. */
  children?: ReactNode;
  rightRail?: ReactNode;
}

/**
 * A single-region flex item. `min-w-0` lets it shrink below its content's
 * intrinsic width instead of forcing the column wider (the classic flexbox
 * min-width:auto trap), and `break-words` gives an unbroken string somewhere
 * to wrap — together they keep the root free of horizontal overflow at
 * narrow viewports (UX-DR11) no matter what a caller passes in.
 */
const Region = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0 break-words">{children}</div>
);

/**
 * A region prop counts as present unless it is `undefined`, `null`, or
 * `false` (rule 2: "an absent region renders nothing — no wrapper, no
 * spacer"). `null` and `false` are not edge cases here — they are the two
 * idioms a caller reaches for reflexively: `cond ? <X/> : null` and
 * `cond && <X/>`. Checking only `!== undefined` let both through as
 * "present," emitting an empty wrapper (and, for the content/rail row, a
 * real spacer) for content that is not there.
 */
const isRegionPresent = (node: ReactNode): boolean =>
  node !== undefined && node !== null && node !== false;

export function Entity360({
  breadcrumb,
  identityHeader,
  statBand,
  alertSlot,
  tabBar,
  children,
  rightRail,
}: Entity360Props): ReactElement {
  const hasContentRow = isRegionPresent(children) || isRegionPresent(rightRail);

  return (
    <div className="flex flex-col gap-4">
      {isRegionPresent(breadcrumb) ? <Region>{breadcrumb}</Region> : null}
      {isRegionPresent(identityHeader) ? (
        <Region>{identityHeader}</Region>
      ) : null}
      {isRegionPresent(statBand) ? <Region>{statBand}</Region> : null}
      {isRegionPresent(alertSlot) ? <Region>{alertSlot}</Region> : null}
      {isRegionPresent(tabBar) ? <Region>{tabBar}</Region> : null}
      {hasContentRow ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {isRegionPresent(children) ? (
            <div className="min-w-0 flex-1 break-words">{children}</div>
          ) : null}
          {isRegionPresent(rightRail) ? (
            <div className="min-w-0 break-words lg:w-80 lg:shrink-0">
              {rightRail}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

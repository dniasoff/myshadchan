import { CanAccess, useTranslate } from "ra-core";

import { MetricsCards } from "../dashboard/MetricsCards";
import { SectionLabel } from "./SectionLabel";

/**
 * Story 15.2's north-star and counter-metrics, in the one place they belong.
 *
 * These measure whether the PRODUCT is working — cross-account leaks,
 * mis-routed items, duplicate false-positive rate, trial-to-paid conversion,
 * AI cost per active family. They answer the operator's question, never the
 * family's, and they are account-wide on a dashboard that is otherwise
 * entirely per-single. They rendered second on `Dashboard` until now.
 *
 * `CanAccess resource="members"` is the same admin gate `TopBar` uses for the
 * Users menu. Note what it is doing HERE and not there: on the dashboard the
 * gate was useless, because `handle_new_user()` makes the first login in a
 * fresh database `administrator = true` — so on a small deployment the
 * operator and the parent are one person, and the gate simply let them keep
 * seeing operator metrics on the family page. Moving the metrics to Settings
 * fixes that by page; the gate is only what keeps them off a NON-admin's
 * Settings, where they would be noise at best and a leak of other families'
 * aggregates at worst.
 */
export const PlatformMetricsSection = () => {
  const translate = useTranslate();

  return (
    <CanAccess resource="members" action="list">
      <div>
        <SectionLabel>
          {translate("crm.settings.platform_metrics.eyebrow", {
            _: "Platform metrics",
          })}
        </SectionLabel>
        <p className="mb-3 px-1 text-xs leading-relaxed text-muted-foreground">
          {translate("crm.settings.platform_metrics.description", {
            _: "How the product itself is doing, across every family. Nothing here is about your own shidduchim.",
          })}
        </p>
        <MetricsCards />
      </div>
    </CanAccess>
  );
};

import { useTranslate } from "ra-core";

import { Progress } from "@/components/ui/progress";

import { AI_MONTHLY_RESUME_LIMIT, usagePercent } from "./billingPlans";

/**
 * The AI resume auto-parse usage meter (E4). Deliberately CALM — it shows how
 * much of the monthly allowance is used, never a warning or an alarm. On the
 * free tier (limit 0) it turns into a gentle upsell line instead of an empty
 * bar, because there is no allowance to meter yet.
 *
 * `used` / `limit` come straight from ai_entitlement(); this component does no
 * entitlement logic of its own.
 */
export const UsageMeter = ({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) => {
  const translate = useTranslate();

  if (limit <= 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium">
          {translate("crm.billing.meter.title", {
            _: "Resume auto-parse",
          })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("crm.billing.meter.freeHint", {
            limit: AI_MONTHLY_RESUME_LIMIT,
            _: "On the AI tier, up to %{limit} resumes a month are read for you. On the free plan you enter the details yourself — nothing is locked away.",
          })}
        </p>
      </div>
    );
  }

  const percent = usagePercent(used, limit);

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {translate("crm.billing.meter.title", {
            _: "Resume auto-parse",
          })}
        </p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {translate("crm.billing.meter.count", {
            used,
            limit,
            _: "%{used} / %{limit} this month",
          })}
        </p>
      </div>
      <Progress value={percent} className="mt-3" />
      <p className="mt-2 text-xs text-muted-foreground">
        {translate("crm.billing.meter.resets", {
          _: "Resets at the start of each month.",
        })}
      </p>
    </div>
  );
};

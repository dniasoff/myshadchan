import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One pricing tier card (E4). Presentational only — it renders the tier it is
 * given and never decides entitlement. `isCurrent` draws the calm "Current plan"
 * marker; the AI tier passes a `cta` (the stubbed Subscribe control).
 */
export const PlanCard = ({
  name,
  priceLabel,
  priceSubLabel,
  features,
  isCurrent,
  highlighted,
  cta,
}: {
  name: string;
  priceLabel: string;
  priceSubLabel?: string;
  features: string[];
  isCurrent: boolean;
  highlighted?: boolean;
  cta?: ReactNode;
}) => {
  const translate = useTranslate();

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        highlighted && "border-primary/40 ring-1 ring-primary/20",
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-4 pt-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{name}</h2>
          {isCurrent ? (
            <Badge variant="secondary">
              {translate("crm.billing.currentPlan", { _: "Current plan" })}
            </Badge>
          ) : null}
        </div>

        <div>
          <p className="font-display text-3xl font-bold tracking-tight">
            {priceLabel}
          </p>
          {priceSubLabel ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {priceSubLabel}
            </p>
          ) : null}
        </div>

        <ul className="flex flex-col gap-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {cta ? <div className="mt-auto pt-2">{cta}</div> : null}
      </CardContent>
    </Card>
  );
};

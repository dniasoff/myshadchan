import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
} from "../analytics/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  AlertTriangle,
  Users,
  DollarSign,
  Clock,
} from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  className?: string;
}

function MetricCard({
  title,
  value,
  icon,
  description,
  trend,
  trendLabel,
  className,
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
            {trendLabel && (
              <p
                className={`text-xs mt-1 flex items-center gap-1 ${
                  trend === "up"
                    ? "text-green-600"
                    : trend === "down"
                      ? "text-red-600"
                      : "text-muted-foreground"
                }`}
              >
                {trend === "up" && <TrendingUp className="size-3" />}
                {trend === "down" && <AlertTriangle className="size-3" />}
                {trendLabel}
              </p>
            )}
          </div>
          <div className="p-2 bg-muted rounded-lg">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export const MetricsCards = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { data: summary, isLoading: summaryLoading } =
    useQuery<AnalyticsEventsSummaryRow | null>({
      queryKey: ["analytics", "summary"],
      queryFn: async () => {
        if (!dataProvider.getAnalyticsSummary) return null;
        return dataProvider.getAnalyticsSummary();
      },
      staleTime: 60000,
    });

  const { data: counterMetrics, isLoading: counterLoading } =
    useQuery<CounterMetrics | null>({
      queryKey: ["analytics", "counterMetrics"],
      queryFn: async () => {
        if (!dataProvider.getCounterMetrics) return null;
        return dataProvider.getCounterMetrics();
      },
      staleTime: 60000,
    });

  const isLoading = summaryLoading || counterLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4 h-24" />
          </Card>
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          title={translate("crm.analytics.metrics.items_filed")}
          value={0}
          icon={<Users className="size-5 text-muted-foreground" />}
        />
        <MetricCard
          title={translate("crm.analytics.metrics.duplicates_confirmed")}
          value={0}
          icon={<AlertTriangle className="size-5 text-muted-foreground" />}
        />
        <MetricCard
          title={translate("crm.analytics.metrics.reference_calls")}
          value={0}
          icon={<Users className="size-5 text-muted-foreground" />}
        />
        <MetricCard
          title={translate("crm.analytics.metrics.channel_captures")}
          value={0}
          icon={<Clock className="size-5 text-muted-foreground" />}
        />
        <MetricCard
          title={translate("crm.analytics.metrics.avg_time_to_file")}
          value="0m"
          icon={<Clock className="size-5 text-muted-foreground" />}
        />
      </div>
    );
  }

  const formatTime = (ms: number | null) => {
    if (!ms) return "0m";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <MetricCard
        title={translate("crm.analytics.metrics.items_filed")}
        value={summary.items_filed ?? 0}
        icon={<Users className="size-5 text-blue-600" />}
      />
      <MetricCard
        title={translate("crm.analytics.metrics.duplicates_confirmed")}
        value={summary.duplicates_confirmed ?? 0}
        icon={<AlertTriangle className="size-5 text-amber-600" />}
      />
      <MetricCard
        title={translate("crm.analytics.metrics.reference_calls")}
        value={summary.reference_calls_logged ?? 0}
        icon={<Users className="size-5 text-green-600" />}
      />
      <MetricCard
        title={translate("crm.analytics.metrics.channel_captures")}
        value={summary.channel_captures ?? 0}
        icon={<Clock className="size-5 text-purple-600" />}
      />
      <MetricCard
        title={translate("crm.analytics.metrics.avg_time_to_file")}
        value={formatTime(summary.avg_time_to_file_ms ?? null)}
        icon={<Clock className="size-5 text-orange-600" />}
      />
      {counterMetrics && (
        <>
          <MetricCard
            title={translate("crm.analytics.metrics.cross_account_leaks")}
            value={counterMetrics.cross_account_leak_reports}
            icon={<AlertTriangle className="size-5 text-red-600" />}
            description={translate("crm.analytics.metrics.should_be_zero")}
            trend={
              counterMetrics.cross_account_leak_reports > 0 ? "down" : "neutral"
            }
            trendLabel={
              counterMetrics.cross_account_leak_reports > 0
                ? translate("crm.analytics.metrics.alert")
                : undefined
            }
          />
          <MetricCard
            title={translate("crm.analytics.metrics.misrouted_items")}
            value={counterMetrics.misrouted_channel_items}
            icon={<AlertTriangle className="size-5 text-amber-600" />}
            trend={
              counterMetrics.misrouted_channel_items > 0 ? "down" : "neutral"
            }
          />
          <MetricCard
            title={translate("crm.analytics.metrics.duplicate_false_positive")}
            value={`${counterMetrics.duplicate_flag_false_positive_rate}%`}
            icon={<AlertTriangle className="size-5 text-amber-600" />}
            description={translate("crm.analytics.metrics.dismissed_rate")}
          />
          <MetricCard
            title={translate("crm.analytics.metrics.trial_to_paid")}
            value={`${counterMetrics.trial_to_paid_conversion}%`}
            icon={<TrendingUp className="size-5 text-green-600" />}
            trend={
              counterMetrics.trial_to_paid_conversion > 0 ? "up" : "neutral"
            }
          />
          <MetricCard
            title={translate("crm.analytics.metrics.ai_cost_per_family")}
            value={`$${counterMetrics.ai_cost_per_active_family.toFixed(2)}`}
            icon={<DollarSign className="size-5 text-blue-600" />}
          />
        </>
      )}
    </div>
  );
};

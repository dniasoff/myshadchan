import { getSupabaseClient } from "./supabase";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
} from "../../analytics/types";

export async function getAnalyticsSummary(): Promise<AnalyticsEventsSummaryRow | null> {
  const { data, error } = await getSupabaseClient()
    .from("analytics_events_summary")
    .select("*")
    .single();

  if (error) {
    console.error("getAnalyticsSummary.error", error);
    return null;
  }

  return data as AnalyticsEventsSummaryRow;
}

export async function getCounterMetrics(): Promise<CounterMetrics> {
  const [
    { data: crossAccountLeakReports },
    { data: misroutedChannelItems },
    { data: duplicateFlagFalsePositiveRate },
    { data: trialToPaidConversion },
    { data: aiCostPerActiveFamily },
  ] = await Promise.all([
    getSupabaseClient().rpc("cross_account_leak_reports"),
    getSupabaseClient().rpc("misrouted_channel_items"),
    getSupabaseClient().rpc("duplicate_flag_false_positive_rate"),
    getSupabaseClient().rpc("trial_to_paid_conversion"),
    getSupabaseClient().rpc("ai_cost_per_active_family"),
  ]);

  return {
    cross_account_leak_reports: crossAccountLeakReports ?? 0,
    misrouted_channel_items: misroutedChannelItems ?? 0,
    duplicate_flag_false_positive_rate: duplicateFlagFalsePositiveRate ?? 0,
    trial_to_paid_conversion: trialToPaidConversion ?? 0,
    ai_cost_per_active_family: aiCostPerActiveFamily ?? 0,
  };
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_analytics_enabled", {
    p_enabled: enabled,
  });

  if (error) {
    console.error("setAnalyticsEnabled.error", error);
    throw new Error("Failed to update analytics preference");
  }
}

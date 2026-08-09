import type { CrmDataProvider } from "../types";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
} from "../../analytics/types";

export const analyticsCustomMethods = {
  async getAnalyticsSummary(): Promise<AnalyticsEventsSummaryRow | null> {
    // This will be called via the dataProvider with the baseDataProvider and activeAccountId
    // We need to access the internal state - for now, we'll use a workaround
    // The actual implementation will be wired in dataProvider.ts
    return null;
  },

  async getCounterMetrics(): Promise<CounterMetrics> {
    return {
      cross_account_leak_reports: 0,
      misrouted_channel_items: 0,
      duplicate_flag_false_positive_rate: 0,
      trial_to_paid_conversion: 0,
      ai_cost_per_active_family: 0,
    };
  },

  async setAnalyticsEnabled(_enabled: boolean): Promise<void> {
    // No-op in FakeRest - managed client-side
  },
} satisfies Partial<CrmDataProvider>;

import type { Db } from "../dataGenerator/types";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
  AnalyticsEventRow,
} from "../../../analytics/types";

export async function getAnalyticsSummary(
  baseDataProvider: any,
  activeAccountId: number,
): Promise<AnalyticsEventsSummaryRow | null> {
  const { data } = await baseDataProvider.getList("analytics_events", {
    filter: { account_id: activeAccountId },
    pagination: { page: 1, perPage: 10_000 },
    sort: { field: "created_at", order: "DESC" },
  });

  if (data.length === 0) {
    return {
      account_id: activeAccountId,
      items_filed: 0,
      duplicates_confirmed: 0,
      reference_calls_logged: 0,
      channel_captures: 0,
      avg_time_to_file_ms: null,
      total_events: 0,
    };
  }

  const itemsFiled = data.filter(
    (e: any) => e.event_type === "item_filed",
  ).length;
  const duplicatesConfirmed = data.filter(
    (e: any) => e.event_type === "duplicate_confirmed",
  ).length;
  const referenceCallsLogged = data.filter(
    (e: any) => e.event_type === "reference_call_logged",
  ).length;
  const channelCaptures = data.filter(
    (e: any) => e.event_type === "channel_capture",
  ).length;
  const timeToFileEvents = data.filter(
    (e: any) => e.event_type === "time_to_file",
  );
  const avgTimeToFileMs =
    timeToFileEvents.length > 0
      ? Math.round(
          timeToFileEvents.reduce(
            (sum: number, e: any) => sum + (e.properties?.time_to_file_ms ?? 0),
            0,
          ) / timeToFileEvents.length,
        )
      : null;

  return {
    account_id: activeAccountId,
    items_filed: itemsFiled,
    duplicates_confirmed: duplicatesConfirmed,
    reference_calls_logged: referenceCallsLogged,
    channel_captures: channelCaptures,
    avg_time_to_file_ms: avgTimeToFileMs,
    total_events: data.length,
  };
}

export async function getCounterMetrics(
  baseDataProvider: any,
  activeAccountId: number,
): Promise<CounterMetrics> {
  // Cross-account leak reports: should always be 0 in FakeRest too
  const { data: allEvents } = await baseDataProvider.getList(
    "analytics_events",
    {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "created_at", order: "DESC" },
    },
  );
  const crossAccountLeakReports = allEvents.filter(
    (e: any) => e.account_id !== activeAccountId,
  ).length;

  // Mis-routed channel items
  const { data: inboxItems } = await baseDataProvider.getList("inbox_items", {
    filter: { account_id: activeAccountId },
    pagination: { page: 1, perPage: 10_000 },
    sort: { field: "created_at", order: "DESC" },
  });
  const misroutedChannelItems = inboxItems.filter(
    (i: any) =>
      (i.source === "shadchan" && i.connection_id == null) ||
      (["email", "whatsapp", "sms"].includes(i.source) &&
        i.sender_needs_confirmation),
  ).length;

  // Duplicate flag false positive rate
  const duplicateEvents = allEvents.filter(
    (e: any) =>
      e.account_id === activeAccountId &&
      e.event_type === "duplicate_confirmed",
  );
  const totalDuplicateFlags = duplicateEvents.length;
  const dismissedDuplicateFlags = duplicateEvents.filter(
    (e: any) => e.properties?.dismissed === true,
  ).length;
  const duplicateFlagFalsePositiveRate =
    totalDuplicateFlags > 0
      ? Math.round(
          (dismissedDuplicateFlags / totalDuplicateFlags) * 100 * 100,
        ) / 100
      : 0;

  // Trial to paid conversion (from accounts table)
  const { data: accounts } = await baseDataProvider.getList("accounts", {
    filter: {},
    pagination: { page: 1, perPage: 10_000 },
    sort: { field: "id", order: "ASC" },
  });
  const trialStarted = accounts.filter((a: any) => a.trial_end != null).length;
  const activeSubscriptions = accounts.filter(
    (a: any) => a.subscription_status === "active" && a.plan != null,
  ).length;
  const trialToPaidConversion =
    trialStarted > 0
      ? Math.round((activeSubscriptions / trialStarted) * 100 * 100) / 100
      : 0;

  // AI cost per active family (from ai_usage_meter table)
  const { data: aiUsage } = await baseDataProvider
    .getList("ai_usage_meter", {
      filter: { account_id: activeAccountId },
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "created_at", order: "DESC" },
    })
    .catch(() => ({ data: [] }));
  const totalCost = aiUsage.reduce(
    (sum: number, u: any) => sum + (u.cost_usd ?? 0),
    0,
  );
  const activeAccounts = accounts.filter(
    (a: any) => a.id === activeAccountId,
  ).length;
  const aiCostPerActiveFamily =
    activeAccounts > 0
      ? Math.round((totalCost / activeAccounts) * 10000) / 10000
      : 0;

  return {
    cross_account_leak_reports: crossAccountLeakReports,
    misrouted_channel_items: misroutedChannelItems,
    duplicate_flag_false_positive_rate: duplicateFlagFalsePositiveRate,
    trial_to_paid_conversion: trialToPaidConversion,
    ai_cost_per_active_family: aiCostPerActiveFamily,
  };
}

export async function setAnalyticsEnabled(
  _baseDataProvider: any,
  activeAccountId: number,
  enabled: boolean,
): Promise<void> {
  // In FakeRest, we just store this in the account's config or a settings table
  // For now, this is a no-op since FakeRest doesn't persist settings across reloads
  // The actual toggle state is managed client-side via IndexedDB in eventCollector.ts
  console.warn(
    `[FakeRest] setAnalyticsEnabled(${enabled}) for account ${activeAccountId}`,
  );
}

export function seedAnalyticsEvents(db: Db, accountId: number): void {
  const now = new Date();
  const events: AnalyticsEventRow[] = [
    {
      id: 1,
      account_id: accountId,
      event_type: "item_filed",
      properties: {
        suggestion_id: 1,
        candidate_id: 1,
        source_channel: "whatsapp",
      },
      created_at: new Date(now.getTime() - 86400000 * 5).toISOString(),
    },
    {
      id: 2,
      account_id: accountId,
      event_type: "item_filed",
      properties: {
        suggestion_id: 2,
        candidate_id: 2,
        source_channel: "email",
      },
      created_at: new Date(now.getTime() - 86400000 * 3).toISOString(),
    },
    {
      id: 3,
      account_id: accountId,
      event_type: "duplicate_confirmed",
      properties: {
        suggestion_id: 3,
        matched_suggestion_id: 1,
        flag_type: "duplicate",
        dismissed: false,
      },
      created_at: new Date(now.getTime() - 86400000 * 2).toISOString(),
    },
    {
      id: 4,
      account_id: accountId,
      event_type: "duplicate_confirmed",
      properties: {
        suggestion_id: 4,
        matched_suggestion_id: 2,
        flag_type: "already_dated",
        dismissed: true,
      },
      created_at: new Date(now.getTime() - 86400000 * 1).toISOString(),
    },
    {
      id: 5,
      account_id: accountId,
      event_type: "reference_call_logged",
      properties: {
        reference_link_id: 1,
        suggestion_id: 1,
        call_status: "answered",
      },
      created_at: new Date(now.getTime() - 86400000 * 4).toISOString(),
    },
    {
      id: 6,
      account_id: accountId,
      event_type: "channel_capture",
      properties: {
        inbox_item_id: 1,
        channel_type: "whatsapp",
        has_attachment: false,
      },
      created_at: new Date(now.getTime() - 86400000 * 6).toISOString(),
    },
    {
      id: 7,
      account_id: accountId,
      event_type: "channel_capture",
      properties: {
        inbox_item_id: 2,
        channel_type: "email",
        has_attachment: true,
      },
      created_at: new Date(now.getTime() - 86400000 * 4).toISOString(),
    },
    {
      id: 8,
      account_id: accountId,
      event_type: "time_to_file",
      properties: { inbox_item_id: 1, time_to_file_ms: 1800000 },
      created_at: new Date(now.getTime() - 86400000 * 5).toISOString(),
    },
    {
      id: 9,
      account_id: accountId,
      event_type: "time_to_file",
      properties: { inbox_item_id: 2, time_to_file_ms: 3600000 },
      created_at: new Date(now.getTime() - 86400000 * 3).toISOString(),
    },
  ];

  db.analytics_events = events;
}

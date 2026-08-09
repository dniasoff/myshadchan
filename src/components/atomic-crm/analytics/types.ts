import { z } from "zod";

export const EVENT_TYPES = [
  "item_filed",
  "duplicate_confirmed",
  "reference_call_logged",
  "channel_capture",
  "time_to_file",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ItemFiledPropertiesSchema = z.strictObject({
  suggestion_id: z.number(),
  candidate_id: z.number().optional(),
  source_channel: z.string(),
});

export const DuplicateConfirmedPropertiesSchema = z.strictObject({
  suggestion_id: z.number(),
  matched_suggestion_id: z.number(),
  flag_type: z.enum(["duplicate", "already_dated"]),
  dismissed: z.boolean().optional(),
});

export const ReferenceCallLoggedPropertiesSchema = z.strictObject({
  reference_link_id: z.number(),
  suggestion_id: z.number().optional(),
  call_status: z.string(),
});

export const ChannelCapturePropertiesSchema = z.strictObject({
  inbox_item_id: z.number(),
  channel_type: z.string(),
  has_attachment: z.boolean(),
});

export const TimeToFilePropertiesSchema = z.strictObject({
  inbox_item_id: z.number(),
  time_to_file_ms: z.number(),
});

export const EventPropertiesSchema = z.union([
  ItemFiledPropertiesSchema,
  DuplicateConfirmedPropertiesSchema,
  ReferenceCallLoggedPropertiesSchema,
  ChannelCapturePropertiesSchema,
  TimeToFilePropertiesSchema,
]);

export const AnalyticsEventSchema = z.strictObject({
  event_type: z.enum(EVENT_TYPES),
  properties: EventPropertiesSchema,
  created_at: z.string().datetime({ offset: true }).optional(),
});

export type ItemFiledProperties = z.infer<typeof ItemFiledPropertiesSchema>;
export type DuplicateConfirmedProperties = z.infer<
  typeof DuplicateConfirmedPropertiesSchema
>;
export type ReferenceCallLoggedProperties = z.infer<
  typeof ReferenceCallLoggedPropertiesSchema
>;
export type ChannelCaptureProperties = z.infer<
  typeof ChannelCapturePropertiesSchema
>;
export type TimeToFileProperties = z.infer<typeof TimeToFilePropertiesSchema>;
export type EventProperties = z.infer<typeof EventPropertiesSchema>;
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsEventsBatchSchema = z.strictObject({
  events: z.array(AnalyticsEventSchema).min(1).max(100),
});

export type AnalyticsEventsBatch = z.infer<typeof AnalyticsEventsBatchSchema>;

export interface AnalyticsEventRow {
  id: number;
  account_id: number;
  event_type: EventType;
  properties: EventProperties;
  created_at: string;
}

export interface AnalyticsEventsSummaryRow {
  account_id: number;
  items_filed: number;
  duplicates_confirmed: number;
  reference_calls_logged: number;
  channel_captures: number;
  avg_time_to_file_ms: number | null;
  total_events: number;
}

export interface CounterMetrics {
  cross_account_leak_reports: number;
  misrouted_channel_items: number;
  duplicate_flag_false_positive_rate: number;
  trial_to_paid_conversion: number;
  ai_cost_per_active_family: number;
}

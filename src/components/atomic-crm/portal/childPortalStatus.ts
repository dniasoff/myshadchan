import type { PipelineState } from "../types";

/**
 * Calm, child-facing status labels — the exact mirror of the CASE in
 * public.get_child_portal() (supabase/schemas/02_functions.sql). Only the three
 * child-visible states can carry a label; the other four never reach the portal
 * (public.is_child_visible_state gates them out). The database is the source of
 * truth in production — get_child_portal returns the label ready-made — so this
 * map exists ONLY so the FakeRest demo mirror produces identical wording.
 */
export const CHILD_PORTAL_STATUS_LABELS: Partial<
  Record<PipelineState, string>
> = {
  look_into: "Being looked into",
  unsure: "Still being considered",
  yes: "Looking promising",
};

export const childPortalStatusLabel = (state: PipelineState): string | null =>
  CHILD_PORTAL_STATUS_LABELS[state] ?? null;

import { PIPELINE_STATES } from "../shidduchim/pipelineStates";
import type { PipelineState, ShidduchSummary } from "../types";

export interface StateBucket {
  state: PipelineState;
  label: string;
  labelHe: string;
  token: string;
  count: number;
}

/**
 * Bucket a child's shidduchim into ordered per-state counts for the pipeline
 * snapshot (design-language §5.6). All 7 states are always present, in
 * `PIPELINE_STATES` order, even when their count is zero — this keeps the
 * legend stable regardless of which states the child currently has.
 */
export const bucketByState = (summaries: ShidduchSummary[]): StateBucket[] =>
  PIPELINE_STATES.map((def) => ({
    state: def.value,
    label: def.label,
    labelHe: def.labelHe,
    token: def.token,
    count: summaries.filter((item) => item.pipeline_state === def.value)
      .length,
  }));

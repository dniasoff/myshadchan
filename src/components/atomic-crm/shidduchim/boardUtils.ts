import { format } from "date-fns";

import type { PipelineState, ShidduchSummary } from "../types";
import { PIPELINE_STATE_VALUES } from "./pipelineStates";

export type ShidduchimByState = Record<PipelineState, ShidduchSummary[]>;

/**
 * Group a single's shidduchim into per-state columns, ordered by `index`
 * within each column, for the pipeline Kanban board. A row with an unknown
 * state is bucketed into the first state, never dropped.
 */
export const getShidduchimByState = (
  items: ShidduchSummary[],
): ShidduchimByState => {
  const byState = PIPELINE_STATE_VALUES.reduce(
    (acc, state) => ({ ...acc, [state]: [] as ShidduchSummary[] }),
    {} as ShidduchimByState,
  );
  items.forEach((item) => {
    const state = PIPELINE_STATE_VALUES.includes(item.pipeline_state)
      ? item.pipeline_state
      : PIPELINE_STATE_VALUES[0];
    byState[state].push(item);
  });
  PIPELINE_STATE_VALUES.forEach((state) => {
    byState[state] = byState[state].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
  });
  return byState;
};

/** Format a YYYY-MM-DD redt date as "9 Jul 2026" (timezone-safe). */
export const formatRedtDate = (dateString?: string | null): string => {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return format(new Date(year, month - 1, day), "d MMM yyyy");
};

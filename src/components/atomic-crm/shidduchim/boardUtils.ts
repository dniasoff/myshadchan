import { format } from "date-fns";

import type { PipelineState, ShidduchSummary } from "../types";
import { PIPELINE_STATE_VALUES } from "./pipelineStates";

export type ShidduchimByState = Record<PipelineState, ShidduchSummary[]>;

/**
 * Group a child's shidduchim into per-state columns, ordered by `index`
 * within each column (mirrors getDealsByStage for the deals Kanban). A row with
 * an unknown state is bucketed into the first state, never dropped.
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

/** Two-letter monogram from an English name, e.g. "Ari Rosenberg" -> "AR". */
export const getMonogram = (name?: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Deterministic avatar palette index (0-9) from a seed string. */
export const getAvatarIndex = (seed?: string | null): number => {
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 10;
};

/** Format a YYYY-MM-DD redt date as "9 Jul 2026" (timezone-safe). */
export const formatRedtDate = (dateString?: string | null): string => {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return format(new Date(year, month - 1, day), "d MMM yyyy");
};

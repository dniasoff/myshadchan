import type { PipelineState, PipelineTransition } from "../types";

export type PipelineGroup = "triage" | "decision";

export interface PipelineStateDef {
  value: PipelineState;
  /** English label (board column header). */
  label: string;
  /** Hebrew label shown alongside (Heebo, RTL). Bilingual domain data (AD-12/AD-18). */
  labelHe: string;
  /** Which board half the column belongs to. */
  group: PipelineGroup;
  /** CSS custom-property token driving the column dot / underline / accent. */
  token: string;
  /** Optional caption distinguishing gut vs post-investigation (FR16). */
  note?: string;
}

/**
 * The one canonical, ordered list of the 7 pipeline states (AD-4). Mirrors the
 * Postgres `public.pipeline_state` enum; array order = board column order.
 * Gut `for_sure_not` (--st-fsn) is deliberately distinct from post-investigation
 * `no` (--st-no) — they never share a token or a label (FR16).
 */
export const PIPELINE_STATES: PipelineStateDef[] = [
  {
    value: "new",
    label: "New",
    labelHe: "חדש",
    group: "triage",
    token: "--st-new",
  },
  {
    value: "look_into",
    label: "Look-into",
    labelHe: "לבדוק",
    group: "triage",
    token: "--st-look",
  },
  {
    value: "not_sure",
    label: "Not-sure",
    labelHe: "לא בטוחה",
    group: "triage",
    token: "--st-notsure",
  },
  {
    value: "for_sure_not",
    label: "For-sure-not",
    labelHe: "בטוח לא",
    group: "triage",
    token: "--st-fsn",
    note: "Gut set-aside — no full look yet.",
  },
  {
    value: "yes",
    label: "Yes",
    labelHe: "כן",
    group: "decision",
    token: "--st-yes",
  },
  {
    value: "unsure",
    label: "Unsure",
    labelHe: "מתלבטת",
    group: "decision",
    token: "--st-unsure",
  },
  {
    value: "no",
    label: "No",
    labelHe: "לא",
    group: "decision",
    token: "--st-no",
    note: "Looked into — decided against.",
  },
];

export const PIPELINE_STATE_VALUES: PipelineState[] = PIPELINE_STATES.map(
  (s) => s.value,
);

export const PIPELINE_GROUPS: { id: PipelineGroup; label: string }[] = [
  { id: "triage", label: "Triage" },
  { id: "decision", label: "Decision" },
];

/**
 * Transitions-as-data (AD-4 invariant 2) — mirrors public.pipeline_transitions.
 * Decision states (yes/unsure/no) are reachable ONLY from look_into. The
 * remaining states (for_sure_not/yes/unsure/no) are terminal for v1.
 */
export const PIPELINE_TRANSITIONS: PipelineTransition[] = [
  { from_state: "new", to_state: "look_into" },
  { from_state: "new", to_state: "not_sure" },
  { from_state: "new", to_state: "for_sure_not" },
  { from_state: "not_sure", to_state: "look_into" },
  { from_state: "not_sure", to_state: "for_sure_not" },
  { from_state: "look_into", to_state: "yes" },
  { from_state: "look_into", to_state: "unsure" },
  { from_state: "look_into", to_state: "no" },
];

/**
 * States a shidduch may be CREATED in — triage only. A gut pass may file
 * straight into for_sure_not, but decision states are never reachable at
 * creation (only from look_into via transitionShidduch). Mirrors the initial
 * guard in create_shidduch().
 */
export const INITIAL_PIPELINE_STATES: PipelineState[] = [
  "new",
  "look_into",
  "not_sure",
  "for_sure_not",
];

/**
 * Closed enumeration (AD-3, D5) of which states a child may see. All 7 states
 * are classified explicitly, mirroring is_child_visible_state() in Postgres —
 * no include/exclude gap. (The child portal itself is Epic-9; this locks the
 * decision now so the schema needs no breaking change later.)
 */
export const CHILD_VISIBLE_STATES: Record<PipelineState, boolean> = {
  new: false,
  look_into: true,
  not_sure: false,
  for_sure_not: false,
  yes: true,
  unsure: true,
  no: false,
};

/**
 * Whether moving a shidduch from `from` to `to` is a legal board move. A move
 * within the same column (reorder, from === to) is always allowed; otherwise
 * the edge must exist in the transition graph. This is the frontend mirror of
 * transition_shidduch()'s guard — the DB remains the enforcing authority.
 */
export const isValidTransition = (
  from: PipelineState,
  to: PipelineState,
): boolean =>
  from === to ||
  PIPELINE_TRANSITIONS.some((t) => t.from_state === from && t.to_state === to);

export const getPipelineStateDef = (
  value: PipelineState,
): PipelineStateDef | undefined =>
  PIPELINE_STATES.find((s) => s.value === value);

export const isChildVisibleState = (value: PipelineState): boolean =>
  CHILD_VISIBLE_STATES[value] ?? false;

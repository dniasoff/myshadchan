import type { PipelineState, ShidduchSummary } from "../types";

/**
 * The four things a parent running a shidduch process actually has to know,
 * derived from the job rather than from what a metric happens to be cheap to
 * count. In priority order, because that is the order they bite:
 *
 *  1. Who am I keeping waiting?  A suggestion nobody has answered is a debt to
 *     a real person. A shadchan who redts and hears nothing back stops redting,
 *     so this one has a social cost the others do not.
 *  2. What did I say I'd look into and never start?  Saying "we'll look into
 *     it" is free; making the first reference call is the work. A `look_into`
 *     with no references logged is where the process actually stalls.
 *  3. What is quietly going stale?  Nothing announces itself as forgotten.
 *  4. Are we getting anywhere?  The row ends on progress, not alarm — this is
 *     a stressful process and the dashboard's job is relief, not nagging
 *     (design-language §5.8, the same voice AttentionSection is written in).
 *
 * Deliberately per-single, like everything else on the dashboard. The metric
 * row this replaces was account-wide, which is part of why it read as foreign
 * to the page it sat on.
 */
export type ParentFocusKey =
  "needs_answer" | "not_researched" | "waiting_a_while" | "moving_forward";

export type ParentFocusTone = "action" | "attention" | "progress";

export interface ParentFocusItem {
  key: ParentFocusKey;
  label: string;
  count: number;
  /**
   * Read under the number. At zero it is a genuine all-clear rather than a
   * blank or a nagging restatement — a parent looking at four zeroes should
   * feel finished, not suspicious.
   */
  caption: string;
  tone: ParentFocusTone;
}

/**
 * Still in play: no decision has been taken. `for_sure_not` is a gut no and
 * `yes`/`unsure`/`no` are post-investigation decisions (AD-4) — none of them
 * is waiting on the parent, so none of them can go stale.
 */
export const OPEN_STATES: PipelineState[] = ["new", "look_into", "not_sure"];

/**
 * Three weeks. Long enough that a normal back-and-forth (call a reference,
 * wait for them to call back, talk it over at home) never trips it, short
 * enough to catch something genuinely forgotten before the other side
 * concludes the answer was no.
 */
export const STALE_AFTER_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/**
 * `redt_date` is the latest time this suggestion was redt, which is the only
 * time signal the schema carries for it — `shidduchim` has no `updated_at`,
 * and `pipeline_transitions` is the legal transition GRAPH (from_state,
 * to_state), not a history of moves. So this measures "first heard about it a
 * while ago and still undecided", and the caption says exactly that rather
 * than claiming a last-touched date the data cannot support.
 */
const isWaitingAWhile = (item: ShidduchSummary, now: number): boolean => {
  if (!OPEN_STATES.includes(item.pipeline_state)) return false;
  if (!item.redt_date) return false;
  const redt = Date.parse(item.redt_date);
  if (Number.isNaN(redt)) return false;
  return now - redt >= STALE_AFTER_DAYS * DAY_MS;
};

/**
 * Builds the focus row for one single's suggestions.
 *
 * `now` is injected rather than read from the clock so the staleness boundary
 * is testable, and so a re-render cannot make a card flicker across the
 * threshold mid-session.
 */
export const buildParentFocus = (
  summaries: ShidduchSummary[],
  now: Date,
): ParentFocusItem[] => {
  const nowMs = now.getTime();

  const needsAnswer = summaries.filter(
    (item) => item.pipeline_state === "new",
  ).length;

  // `nb_references` rides along on shidduchim_summary, so this costs no extra
  // query and no per-row lookup.
  const notResearched = summaries.filter(
    (item) =>
      item.pipeline_state === "look_into" && (item.nb_references ?? 0) === 0,
  ).length;

  const waitingAWhile = summaries.filter((item) =>
    isWaitingAWhile(item, nowMs),
  ).length;

  const movingForward = summaries.filter(
    (item) => item.pipeline_state === "yes",
  ).length;

  return [
    {
      key: "needs_answer",
      label: "Needs your answer",
      count: needsAnswer,
      caption:
        needsAnswer === 0
          ? "Nobody is waiting on you"
          : `${plural(needsAnswer, "Someone is", "People are")} waiting to hear back`,
      tone: "action",
    },
    {
      key: "not_researched",
      label: "No references called",
      count: notResearched,
      caption:
        notResearched === 0
          ? "Every look-into has been started"
          : `Look-${plural(notResearched, "into with", "intos with")} nobody called yet`,
      tone: "action",
    },
    {
      key: "waiting_a_while",
      label: "Waiting a while",
      count: waitingAWhile,
      caption:
        waitingAWhile === 0
          ? "Nothing has gone quiet"
          : `Still open, first redt over ${STALE_AFTER_DAYS} days ago`,
      tone: "attention",
    },
    {
      key: "moving_forward",
      label: "Moving forward",
      count: movingForward,
      caption:
        movingForward === 0
          ? "Nothing at yes yet"
          : `${plural(movingForward, "Suggestion", "Suggestions")} you said yes to`,
      tone: "progress",
    },
  ];
};

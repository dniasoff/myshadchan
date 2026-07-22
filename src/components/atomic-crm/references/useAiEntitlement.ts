/**
 * THE EPIC-12 ENTITLEMENT SEAM — a placeholder, not an implementation.
 *
 * The research assistant (FR59-63) is the only paid surface in the References
 * epic. No billing or entitlement infrastructure exists anywhere in this
 * codebase yet, so rather than invent one, the decision is a single constant in
 * one obvious place. When Epic-12 lands, replace the body of this hook and
 * nothing else.
 *
 * Two things must stay true when that happens:
 *
 *  1. This decision currently lives in the browser, which makes it a billing
 *     bypass rather than a data leak — the panel renders only data the client
 *     already holds. Before the Epic-10 AI Gateway ships it MUST move
 *     server-side, or a modified client can spend another account's inference
 *     budget.
 *
 *  2. Nothing else in the References surface may call this. The timeline, notes,
 *     reminders, call log, merge and — above all — match-on-entry are free by
 *     requirement (FR20/FR42 are explicitly not paywalled).
 */

/** Flip to false to preview the locked state. Epic-12 replaces this entirely. */
const CAN_USE_AI_DILIGENCE = true;

export type AiEntitlement = {
  isEntitled: boolean;
  isLoading: boolean;
};

export const useAiEntitlement = (): AiEntitlement => ({
  isEntitled: CAN_USE_AI_DILIGENCE,
  isLoading: false,
});

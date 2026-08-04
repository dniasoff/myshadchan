import type { CrossReferenceSummary } from "./dossierFacts";

/**
 * Phrases the narrative must never contain (FR63: it organizes what was
 * learned, it never judges compatibility). Kept as a named export so
 * `deterministicNarrative`'s own test suite can assert against it directly,
 * rather than duplicating the list.
 */
const BANNED_PHRASES = [
  "recommend",
  "compatible",
  "match",
  "score",
  "should date",
  "good fit",
] as const;

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The dossier's narrative summary. Deterministic and pure: the same facts
 * always produce the same sentence, with no network call, no external
 * dependency, and — by construction, not by a wordlist — no banned phrase.
 *
 * Story 11.3 originally paired this with a free-form Claude narrator
 * (`claudeNarrator`, since removed) that layered nicer phrasing on top of
 * these same facts, gated by a six-phrase banned-word blacklist with this
 * function as its fallback on error or disallowed wording. Review fix
 * (Finding 12) removed that free-form path rather than repairing it:
 *
 * - The blacklist is trivially bypassable by paraphrase (Finding 11 — "an
 *   ideal pairing" contains none of the six banned words but reads as
 *   exactly the endorsement FR63 forbids), and nothing validated the
 *   model's prose against the actual input facts, so it could invent a
 *   topic, attribute a view to a reference that never gave one, or add
 *   causation absent from the input.
 * - The model call's own error-fallback path had never been proven to work:
 *   its test (Finding 14) patched a `.client` property `claudeNarrator`
 *   never attached to the returned object, so the patch silently no-op'd
 *   and the test asserted this function directly instead of exercising
 *   `compose()` — proven by deleting the real `try/catch` in a scratchpad
 *   copy and watching the suite stay green.
 * - For a tool whose only stated product guarantee is "never judges
 *   compatibility", a narrative that is safe by construction beats one that
 *   is merely probabilistically safe, call for call: same underlying facts,
 *   no fabrication surface, no added latency or cost, and nothing left that
 *   still needs to be proven under failure.
 *
 * Given that, `deterministicNarrative` is no longer a fallback — it is the
 * dossier's only narrative implementation.
 */
export function deterministicNarrative(facts: CrossReferenceSummary): string {
  if (facts.spokenTo.length === 0) {
    return "Nothing has been recorded from reference calls yet.";
  }

  const parts: string[] = [];

  parts.push(
    `${formatCount(facts.spokenTo.length, "reference", "references")} ${facts.spokenTo.length === 1 ? "was" : "were"} spoken to.`,
  );

  if (facts.endorsements.length > 0 && facts.reservations.length > 0) {
    parts.push(
      `${formatCount(facts.endorsements.length, "spoke warmly", "spoke warmly")} and ${formatCount(facts.reservations.length, "raised a reservation", "raised reservations")}. Both perspectives are worth reading in full.`,
    );
  } else if (facts.endorsements.length > 0) {
    parts.push(
      `${formatCount(facts.endorsements.length, "response reads as a warm endorsement", "responses read as warm endorsements")}.`,
    );
  } else if (facts.reservations.length > 0) {
    parts.push(
      `${formatCount(facts.reservations.length, "response includes a reservation", "responses include reservations")}.`,
    );
  }

  if (facts.covered.length > 0) {
    parts.push(
      `Topics covered: ${facts.covered.map((t) => t.label).join(", ")}.`,
    );
  }

  if (facts.gaps.length > 0) {
    parts.push(`Still missing: ${facts.gaps.map((t) => t.label).join(", ")}.`);
  }

  if (facts.outstanding.length > 0) {
    parts.push(
      `${formatCount(facts.outstanding.length, "conversation has", "conversations have")} not happened yet.`,
    );
  }

  return parts.join(" ");
}

export { BANNED_PHRASES };

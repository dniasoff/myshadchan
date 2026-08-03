import Anthropic from "@anthropic-ai/sdk";
import type { CrossReferenceSummary } from "./dossierFacts";

export interface DossierNarrator {
  compose(facts: CrossReferenceSummary): Promise<string>;
}

const BANNED_PHRASES = [
  "recommend",
  "compatible",
  "match",
  "score",
  "should date",
  "good fit",
] as const;

function containsBannedPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase));
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Deterministic narrative built purely from the computed facts. This is the
 * fallback when the model is unavailable, fails, or returns disallowed wording.
 * It never contains a banned phrase by construction.
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

export type NarratorEnv = {
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  ANTHROPIC_API_KEY: string;
};

/**
 * Production narrator. Calls Claude **only** through the Cloudflare AI Gateway.
 * The prompt receives topic labels, counts and booleans — never raw reference
 * text or names — and is checked against a banned-phrase list. Any failure or
 * disallowed wording falls back to the deterministic narrative.
 */
export function claudeNarrator(env: NarratorEnv): DossierNarrator {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`,
  });

  return {
    async compose(facts): Promise<string> {
      const prompt =
        "You are a neutral research assistant summarising what a family has learned from reference calls about a suggestion. " +
        "Do not recommend, score, or judge compatibility. Write one short paragraph in plain English. " +
        "Use only the following facts; do not invent details, quotes, or topics.\n\n" +
        `References spoken to: ${facts.spokenTo.length}\n` +
        `Warm endorsements: ${facts.endorsements.length}\n` +
        `Reservations raised: ${facts.reservations.length}\n` +
        `Topics covered: ${facts.covered.map((t) => t.label).join(", ") || "none"}\n` +
        `Topics still missing: ${facts.gaps.map((t) => t.label).join(", ") || "none"}\n` +
        `References differ: ${facts.hasContradiction ? "yes" : "no"}\n` +
        `Outstanding calls: ${facts.outstanding.length}\n`;

      try {
        const response = await client.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        });

        const text =
          response.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join(" ")
            .trim() || deterministicNarrative(facts);

        if (containsBannedPhrase(text)) {
          return deterministicNarrative(facts);
        }
        return text;
      } catch {
        return deterministicNarrative(facts);
      }
    },
  };
}

export { BANNED_PHRASES };

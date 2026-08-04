/**
 * FR24 original-sender recovery — ported from
 * `supabase/functions/postmark/forwardedParser.ts`'s `extractOriginalSender`
 * (that module is retired along with the rest of the Postmark path, so this
 * is a copy adapted to this Worker, not an import of a module scheduled for
 * deletion). Only the sender-recovery half is ported: the Postmark path's
 * "strip forwarding chrome from the body" convenience branch was gated on a
 * single SHARED inbound address (`VITE_INBOUND_EMAIL`) that this design has
 * no equivalent of — every household now has its own token address, so that
 * branch's precondition never applies here. `raw_text` is stored verbatim,
 * exactly as `buildInboxItemRow.ts`'s own doc comment says.
 */

/** Patterns that mark the beginning of a forwarded block in the email body. */
const FORWARD_SEPARATOR_PATTERNS = [
  // Gmail
  /^-{5,}\s*Forwarded message\s*-{5,}/im,
  // Apple Mail
  /^Begin forwarded message:/im,
  // Outlook / Exchange
  /^-{5,}\s*Original Message\s*-{5,}/im,
  // French clients (Transféré / Message transféré)
  /^-{5,}\s*Message transf[eé]r[eé]\s*-{5,}/im,
  /^-{5,}\s*Transf[eé]r[eé]\s*-{5,}/im,
  // German (Weitergeleitet)
  /^-{5,}\s*Weitergeleitete Nachricht\s*-{5,}/im,
];

const FROM_LABEL_PATTERN = /^(?:From|De|Von)\s*:?\s*(.+)$/im;
const SENDER_VALUE_PATTERN = /^"?([^"<]*?)"?\s*(?:<([^<>]+)>)?$/;

export interface OriginalSenderCandidate {
  name: string | null;
  email: string | null;
  needsConfirmation: boolean;
}

/**
 * Recover the original sender from a forwarded message's header block
 * (FR24). Pure (no I/O), deliberately conservative: a confident result is
 * returned only when exactly one forward separator and exactly one
 * From/De/Von line are found. Anything else — no forward signal, nested
 * forwards, missing or multiple headers — is flagged for human
 * confirmation. The caller (`index.ts`) additionally treats a
 * self-referential match (the recovered address equals the actual sender)
 * as unconfident, since re-attributing an email to its own sender is not
 * useful recovery.
 */
export function extractOriginalSender(body: string): OriginalSenderCandidate {
  const separatorMatches = FORWARD_SEPARATOR_PATTERNS.flatMap((pattern) => {
    const matches = body.match(new RegExp(pattern.source, pattern.flags + "g"));
    return matches ?? [];
  });

  if (separatorMatches.length === 0) {
    return { name: null, email: null, needsConfirmation: false };
  }

  if (separatorMatches.length >= 2) {
    return { name: null, email: null, needsConfirmation: true };
  }

  const lines = body.split("\n");

  // Find the single separator line — from there, scan until the first blank
  // line, which ends the forwarded header block.
  const separatorIndex = lines.findIndex((line) =>
    FORWARD_SEPARATOR_PATTERNS.some((pattern) => pattern.test(line)),
  );
  if (separatorIndex === -1) {
    return { name: null, email: null, needsConfirmation: true };
  }

  const fromLines: string[] = [];
  for (let i = separatorIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    const match = FROM_LABEL_PATTERN.exec(line);
    if (match) {
      fromLines.push(match[1].trim());
    }
  }

  if (fromLines.length !== 1) {
    return { name: null, email: null, needsConfirmation: true };
  }

  const valueMatch = SENDER_VALUE_PATTERN.exec(fromLines[0]);
  if (!valueMatch) {
    return { name: null, email: null, needsConfirmation: true };
  }

  let name = valueMatch[1].trim() || null;
  let email = valueMatch[2]?.trim().toLowerCase() || null;

  // A bare email address in the value (no angle brackets, no display name)
  // should be treated as the email so downstream self-reference checks work.
  if (!email && name && /^[^<>\s]+@[^<>\s]+$/.test(name)) {
    email = name.toLowerCase();
    name = null;
  }

  return {
    name,
    email,
    needsConfirmation: false,
  };
}

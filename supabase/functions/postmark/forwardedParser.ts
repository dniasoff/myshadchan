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

export const stripForwardingHeaderBlock = (text: string): string => {
  const lines = text.split("\n");
  let bodyStartIndex = 0;

  // First check that the first line matches a known forwarding separator pattern
  const hasForwardedSeparator = FORWARD_SEPARATOR_PATTERNS.some((pattern) => {
    const match = lines[0].match(pattern);
    return !!match;
  });
  if (!hasForwardedSeparator) {
    // No known forwarding pattern detected, return the original text
    return text.trim();
  }

  // Walk through the header-like lines at the top of the block
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Blank line signals end of the forwarded header block
    if (line.trim() === "") {
      bodyStartIndex = i + 1;
      break;
    }
    i++;
  }

  // No blank line found after the header → no body to extract
  if (bodyStartIndex === 0) {
    return "";
  }

  return lines.slice(bodyStartIndex).join("\n").trim();
};

export const stripSubjectForwardingPrefix = (subject: string): string => {
  const result = subject
    .replace(/^(Fwd|FW|FWD|Tr|SV|VS|WG|WG:)\s*[:-]\s*/i, "")
    .trim();

  if (result.length === 0) {
    console.warn(
      `Stripping forwarding prefix from subject "${subject}" resulted in empty string, returning original subject`,
    );
    return subject;
  }

  return result;
};

export const stripMailSignature = (text: string): string => {
  const signatureSeparatorIndex = text.indexOf("\n-- \n");
  if (signatureSeparatorIndex !== -1) {
    return text.substring(0, signatureSeparatorIndex).trim();
  }
  return text.trim();
};

export const getForwardedMailContent = (body: string): string => {
  const strippedBody = stripForwardingHeaderBlock(stripMailSignature(body));

  if (strippedBody.length === 0) {
    console.warn(
      "Stripping mail signature and forwarded header block resulted in empty note content, returning original body",
    );
    return body.trim();
  }
  return strippedBody;
};

export interface OriginalSenderCandidate {
  name: string | null;
  email: string | null;
  needsConfirmation: boolean;
}

const FROM_LABEL_PATTERN = /^(?:From|De|Von)\s*:?\s*(.+)$/im;
const SENDER_VALUE_PATTERN = /^"?([^"<]*?)"?\s*(?:<([^<>]+)>)?$/;

/**
 * Recover the original sender from a forwarded message's header block (FR24).
 * Pure (no I/O), deliberately conservative: a confident result is returned only
 * when exactly one forward separator and exactly one From/De/Von line are found.
 * Anything else — no forward signal, nested forwards, missing or multiple
 * headers, or a self-referential address — is flagged for human confirmation.
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

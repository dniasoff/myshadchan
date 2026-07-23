import type { CallStatus, ConversationLogEntry } from "../types";

/**
 * The call-status vocabulary (FR40). These four outcomes plus "not started" are
 * what a shadchan actually records after dialling a reference — "call back" and
 * "they will call back" are deliberately distinct, because who owes whom the
 * next call is the whole point of the follow-up reminder.
 *
 * Tokens are Calm Ledger semantic classes, resolved against the committed
 * theme in src/index.css rather than hard-coded colour values.
 */
export type CallStatusDescriptor = {
  id: CallStatus;
  /** i18n key; the raw label is the fallback for tests and dev. */
  labelKey: string;
  label: string;
  /**
   * CSS custom-property name (e.g. "--positive") driving the chip's dot/tint,
   * mirroring StateChip's `token`-driven recipe (design-language §5.5) — never
   * a hardcoded Tailwind palette colour.
   */
  token: string;
  /** Whether this status means the conversation actually happened. */
  isContacted: boolean;
  /** Whether this status leaves a follow-up owed by us. */
  needsFollowUp: boolean;
};

export const CALL_STATUS_DESCRIPTORS: readonly CallStatusDescriptor[] = [
  {
    id: "not_started",
    labelKey: "crm.references.callStatus.not_started",
    label: "Not started",
    token: "--muted-foreground",
    isContacted: false,
    needsFollowUp: true,
  },
  {
    id: "answered",
    labelKey: "crm.references.callStatus.answered",
    label: "Answered",
    token: "--positive",
    isContacted: true,
    needsFollowUp: false,
  },
  {
    id: "no_answer",
    labelKey: "crm.references.callStatus.no_answer",
    label: "No answer",
    token: "--attention",
    isContacted: false,
    needsFollowUp: true,
  },
  {
    id: "call_back",
    labelKey: "crm.references.callStatus.call_back",
    label: "Call back",
    token: "--primary",
    isContacted: false,
    needsFollowUp: true,
  },
  {
    id: "they_will_call_back",
    labelKey: "crm.references.callStatus.they_will_call_back",
    label: "They will call back",
    token: "--violet",
    isContacted: true,
    needsFollowUp: false,
  },
] as const;

const BY_ID = new Map(CALL_STATUS_DESCRIPTORS.map((d) => [d.id, d]));

/** Falls back to "not started" for a null or unrecognised status. */
export const getCallStatusDescriptor = (
  status?: CallStatus | string | null,
): CallStatusDescriptor =>
  BY_ID.get(status as CallStatus) ?? CALL_STATUS_DESCRIPTORS[0];

/**
 * Progress across a set of links, used both for the reference header and for
 * the coarse "N of M references contacted" signal a candidate may eventually be
 * shown (FR68). It counts statuses only — it never reads what was said.
 */
export const summarizeCallProgress = (
  links: ReadonlyArray<{ call_status?: CallStatus | string | null }>,
): { contacted: number; total: number; outstanding: number } => {
  const total = links.length;
  const contacted = links.filter(
    (link) => getCallStatusDescriptor(link.call_status).isContacted,
  ).length;

  return { contacted, total, outstanding: total - contacted };
};

/** Newest first. The stored log is append-only, so this never mutates it. */
export const sortConversationLog = (
  log?: ConversationLogEntry[] | null,
): ConversationLogEntry[] =>
  [...(log ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

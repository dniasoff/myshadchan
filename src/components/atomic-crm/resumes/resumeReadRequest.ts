import type { Identifier } from "ra-core";

/**
 * A deliberate read keeps its retry key in memory only. The key includes the
 * file identity so a later upload starts a fresh inference instead of
 * replaying the previous file's result.
 */
export const unresolvedResumeReadAttempts = new Map<string, string>();

/** Clears in-memory request ids between tests; production never calls this. */
export function resetResumeReadAttemptsForTests(): void {
  unresolvedResumeReadAttempts.clear();
}

export function resumeReadAttemptKey(
  resumeId: Identifier,
  fileIdentity: string,
): string {
  return `${String(resumeId)}\u0000${fileIdentity}`;
}

export function createResumeReadRequestId(): string {
  return crypto.randomUUID();
}

export interface AuthErrorFallback {
  id: string;
  defaultMessage: string;
}

/**
 * Reads the real error message off a rejected `authProvider` call, narrowing
 * the `unknown` catch value safely (see `.claude/rules/typescript.md`), and
 * falls back to a translatable default when the rejection carries none of
 * its own.
 *
 * Shared by every screen that surfaces a `login()` rejection via `notify()`
 * (LoginPage, RegisterFlow) — each hits the exact same three-way check (a
 * plain string thrown by `authProvider.login()`, a real `Error`, or nothing
 * usable), and duplicating it per screen is exactly the repetition
 * `.claude/rules/coding-style.md`'s DRY section asks to extract once real.
 */
export function resolveAuthErrorNotification(
  error: unknown,
  fallback: AuthErrorFallback,
): AuthErrorFallback {
  if (typeof error === "string" && error.length > 0) {
    return { id: error, defaultMessage: error };
  }
  if (error instanceof Error && error.message) {
    return { id: error.message, defaultMessage: error.message };
  }
  return fallback;
}

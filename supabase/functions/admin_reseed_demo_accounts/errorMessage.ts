/** Narrows an unknown catch value to a display string without ever
 * throwing itself. Shared by every module here that needs to turn a
 * caught error into a message for logging or an `AccountResult.error`
 * field. */
export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isInformative(message: string): boolean {
  return (
    message.length > 0 && message !== "{}" && message !== "[object Object]"
  );
}

function ownStringProp(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ownNumberProp(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Formats a caught Supabase/GoTrue/PostgREST error into a diagnostic string
 * that survives even when `.message` itself is uninformative.
 *
 * Production incident this exists for: every `admin_reseed_demo_accounts`
 * run logged `cleanupWarning: "failed to delete temp user <id>: {}"` — the
 * literal three-character string "{}", not a redacted or truncated message.
 * That is not our own code stringifying something badly; it is
 * `@supabase/auth-js` doing it upstream. Its `handleError()`
 * (`@supabase/auth-js/dist/module/lib/fetch.js`) treats any 5xx response as
 * "retryable" and, for that whole status class, builds the thrown error's
 * `message` by `JSON.stringify()`-ing the raw `Response` object itself, not
 * its body. A `Response`'s fields (`status`, `ok`, `url`, ...) are getters
 * defined on its prototype, not own enumerable properties, so
 * `JSON.stringify(response)` always serializes to "{}" — regardless of what
 * actually went wrong. `.message` is therefore structurally empty for
 * exactly the class of errors (transient failures, server-side rejections)
 * most worth diagnosing.
 *
 * What DOES survive is `.status`, `.name` and `.code` — auth-js assigns
 * those as real own properties in the error's own constructor
 * (`@supabase/auth-js/dist/module/lib/errors.js`), derived from the actual
 * response/JSON body, never from stringifying it. PostgREST errors
 * (`.details` / `.hint` / `.code`) carry the same kind of information
 * `.message` alone can also fail to capture. This pulls all of it into one
 * line, so an operator sees e.g. `AuthRetryableFetchError | status 500 |
 * (no message returned by the API)` instead of a message that says nothing
 * at all — while still preferring the real message when there is one (this
 * keeps every existing "contains the real reason" test passing unchanged).
 */
export function formatSupabaseError(e: unknown): string {
  if (typeof e !== "object" || e === null) return getErrorMessage(e);

  const record = e as Record<string, unknown>;
  const name = ownStringProp(record, "name");
  // Read `.message` directly rather than through `getErrorMessage`'s
  // `instanceof Error` check: every real Supabase error class (AuthError,
  // PostgrestError) does extend Error, but a caller may also have a plain
  // `{ message, status, code }` object (e.g. a raw fetch-error shape) that
  // isn't one, and its message is just as real.
  const rawMessage =
    typeof record.message === "string" ? record.message : getErrorMessage(e);
  const message = isInformative(rawMessage)
    ? rawMessage
    : "(no message returned by the API)";
  const status = ownNumberProp(record, "status");
  const code = ownStringProp(record, "code");
  const details = ownStringProp(record, "details");
  const hint = ownStringProp(record, "hint");

  return [
    name,
    message,
    status !== undefined ? `status ${status}` : undefined,
    code ? `code ${code}` : undefined,
    details ? `details: ${details}` : undefined,
    hint ? `hint: ${hint}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" | ");
}

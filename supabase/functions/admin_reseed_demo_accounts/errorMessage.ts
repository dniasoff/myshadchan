/** Narrows an unknown catch value to a display string without ever
 * throwing itself. Shared by every module here that needs to turn a
 * caught error into a message for logging or an `AccountResult.error`
 * field. */
export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The finalize RPC uses one stable message when the row was restored, the
 * token changed, or the ten-second Undo window has not ended. Keep this
 * contract shared by real and FakeRest providers and the UI's timer path.
 */
export const ENTITY_FILE_DELETE_CHANGED_MESSAGE =
  "entity file delete is still undoable or has changed";

export function isEntityFileDeleteChangedError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  return message === ENTITY_FILE_DELETE_CHANGED_MESSAGE;
}

/** Stable application-level error code for an email that is not registered. */
export const NO_ACCOUNT_FOUND_ERROR_CODE = "no_account_found";

/**
 * Keeps the sign-in recovery decision independent from Supabase's error shape.
 * The auth provider creates this error, while auth screens only need to
 * recognize the stable code and can avoid displaying backend text.
 */
export class NoAccountFoundError extends Error {
  readonly code = NO_ACCOUNT_FOUND_ERROR_CODE;

  constructor() {
    super(NO_ACCOUNT_FOUND_ERROR_CODE);
    this.name = "NoAccountFoundError";
  }
}

export function isNoAccountFoundError(error: unknown): boolean {
  return (
    error instanceof NoAccountFoundError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === NO_ACCOUNT_FOUND_ERROR_CODE)
  );
}

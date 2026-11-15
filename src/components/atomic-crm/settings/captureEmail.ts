/** The live domain every household capture address is minted under. */
export const CAPTURE_EMAIL_DOMAIN = "myshadchan.space";

export const buildCaptureEmail = (
  token: string | null | undefined,
): string | null => {
  const normalizedToken = token?.trim();
  return normalizedToken ? `${normalizedToken}@${CAPTURE_EMAIL_DOMAIN}` : null;
};

export const EMAIL_MAX_RAW_BYTES = 24 * 1024 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUsableEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    EMAIL_PATTERN.test(value.trim())
  );
}

export function isSafeFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    !/[\\/\0\r\n]/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function isAllowedAttachmentMime(
  kind: "resume" | "photo",
  value: unknown,
): value is string {
  if (typeof value !== "string" || value.length > 128) return false;
  const mime = value.toLowerCase();
  return kind === "resume"
    ? [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(mime)
    : ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mime);
}

export function isAccountStoragePath(
  path: unknown,
  accountId: number,
  kind: "resume" | "photo",
  singleId: number,
): path is string {
  if (typeof path !== "string" || path.includes("..") || path.includes("\\")) {
    return false;
  }
  const prefix = `${accountId}/${kind === "resume" ? "resumes" : "photos/shared"}/single-${singleId}/`;
  return (
    path.startsWith(prefix) &&
    path.slice(prefix.length).length > 0 &&
    !path.slice(prefix.length).includes("/")
  );
}

export function toBase64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  let encoded = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    encoded += String.fromCharCode(
      ...data.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(encoded);
}

export function isProviderRateLimitError(error: string): boolean {
  return /Resend responded 429\b/.test(error);
}

export function isProviderServerError(error: string): boolean {
  return (
    /Resend responded 5\d\d\b/.test(error) ||
    error === "transport error contacting Resend"
  );
}

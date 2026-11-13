import { describe, expect, it } from "vitest";

import {
  EMAIL_MAX_RAW_BYTES,
  isAccountStoragePath,
  isAllowedAttachmentMime,
  isProviderRateLimitError,
  isSafeFilename,
  isUsableEmail,
  toBase64,
} from "./emailPayload";

describe("email payload guards", () => {
  it("keeps the application cap below the provider cap", () => {
    expect(EMAIL_MAX_RAW_BYTES).toBe(24 * 1024 * 1024);
  });

  it("accepts only the account's single-owned resume and shared photo path grammars", () => {
    expect(
      isAccountStoragePath("7/resumes/single-42/resume.pdf", 7, "resume", 42),
    ).toBe(true);
    expect(
      isAccountStoragePath(
        "7/photos/shared/single-42/photo.jpg",
        7,
        "photo",
        42,
      ),
    ).toBe(true);
    expect(
      isAccountStoragePath("8/resumes/single-42/resume.pdf", 7, "resume", 42),
    ).toBe(false);
    expect(
      isAccountStoragePath(
        "7/photos/private_parent/single-42/photo.jpg",
        7,
        "photo",
        42,
      ),
    ).toBe(false);
    expect(
      isAccountStoragePath("7/resumes/single-42/../other.pdf", 7, "resume", 42),
    ).toBe(false);
  });

  it("fails closed for unsafe names and unsupported MIME types", () => {
    expect(isSafeFilename("resume.pdf")).toBe(true);
    expect(isSafeFilename("../resume.pdf")).toBe(false);
    expect(isAllowedAttachmentMime("resume", "application/pdf")).toBe(true);
    expect(isAllowedAttachmentMime("photo", "application/pdf")).toBe(false);
    expect(isAllowedAttachmentMime("photo", "image/jpeg")).toBe(true);
  });

  it("validates addresses and encodes bytes without a signed URL", () => {
    expect(isUsableEmail("ronit@example.test")).toBe(true);
    expect(isUsableEmail("not an email")).toBe(false);
    expect(toBase64(Uint8Array.from([1, 2, 3]).buffer)).toBe("AQID");
  });

  it("classifies only the provider rate limit as the rate-limit outcome", () => {
    expect(
      isProviderRateLimitError("Resend responded 429: too many requests"),
    ).toBe(true);
    expect(isProviderRateLimitError("transport error contacting Resend")).toBe(
      false,
    );
  });
});

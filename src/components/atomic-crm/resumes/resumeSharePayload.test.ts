import { describe, expect, it } from "vitest";

import type { ResumeFileVersion } from "../types";
import { buildResumeSharePayload } from "./resumeSharePayload";

/**
 * Story 5.7, AC 4: the forward/share payload holds exactly one
 * `resumes.files` entry — never anything from `resume_photos` (Story 5.4's
 * "a photo is never included in a share unless chosen" guarantee, AD-9).
 */

const buildVersion = (
  overrides: Partial<ResumeFileVersion> = {},
): ResumeFileVersion => ({
  path: "1/resumes/1/abc-resume.pdf",
  filename: "resume.pdf",
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: 7,
  mime_type: "application/pdf",
  size: 2048,
  ...overrides,
});

describe("buildResumeSharePayload", () => {
  it("returns exactly one File, built only from the given blob/version", () => {
    // Arrange
    const blob = new Blob(["contents"], { type: "application/pdf" });
    const version = buildVersion();

    // Act
    const payload = buildResumeSharePayload(blob, version);

    // Assert — the signature accepts no `resume_photos`-shaped input at
    // all, so the payload can never carry a photo (AD-9).
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe(version.filename);
    expect(payload.files[0].type).toBe(version.mime_type);
  });

  it("falls back to the blob's own MIME type when the version carries none", () => {
    // Arrange
    const blob = new Blob(["contents"], { type: "application/pdf" });
    const version = buildVersion({ mime_type: "" });

    // Act
    const payload = buildResumeSharePayload(blob, version);

    // Assert
    expect(payload.files[0].type).toBe("application/pdf");
  });
});

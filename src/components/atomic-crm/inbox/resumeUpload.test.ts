import { describe, expect, it } from "vitest";

import {
  isAutoFillResumeMimeType,
  resumeMimeType,
  validateResumeUpload,
} from "./resumeUpload";

describe("resumeUpload", () => {
  it("accepts the supported resume formats, including Word attachments", () => {
    expect(
      validateResumeUpload({
        name: "resume.pdf",
        type: "application/pdf",
        size: 10,
      }),
    ).toBeNull();
    expect(
      validateResumeUpload({ name: "resume.doc", type: "", size: 10 }),
    ).toBeNull();
    expect(
      validateResumeUpload({ name: "resume.docx", type: "", size: 10 }),
    ).toBeNull();
    expect(
      validateResumeUpload({
        name: "resume.docx",
        type: "application/octet-stream",
        size: 10,
      }),
    ).toBeNull();
    expect(
      validateResumeUpload({ name: "photo.heic", type: "", size: 10 }),
    ).toBeNull();
  });

  it("rejects unsupported types and files over the stated limit", () => {
    expect(
      validateResumeUpload({
        name: "resume.txt",
        type: "text/plain",
        size: 10,
      }),
    ).toMatch(/PDF/);
    expect(
      validateResumeUpload({
        name: "resume.pdf",
        type: "application/pdf",
        size: 8 * 1024 * 1024 + 1,
      }),
    ).toMatch(/8 MB/);
  });

  it("limits auto-fill to the parse Worker's allowlist", () => {
    expect(
      isAutoFillResumeMimeType(
        resumeMimeType({ name: "resume.pdf", type: "" }),
      ),
    ).toBe(true);
    expect(
      isAutoFillResumeMimeType(
        resumeMimeType({ name: "resume.docx", type: "" }),
      ),
    ).toBe(false);
  });
});

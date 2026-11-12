import { describe, expect, it } from "vitest";

import {
  friendlyResumeReadError,
  resumeReadSuccessMessage,
  friendlyResumeUploadError,
  friendlySuggestionSubmitError,
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
    expect(
      validateResumeUpload({
        name: "resume.pdf",
        type: "application/pdf",
        size: 0,
      }),
    ).toMatch(/empty/i);
  });

  it("accepts a file exactly at the 8 MB limit", () => {
    expect(
      validateResumeUpload({
        name: "resume.pdf",
        type: "application/pdf",
        size: 8 * 1024 * 1024,
      }),
    ).toBeNull();
  });

  it("allows modern Word auto-fill while keeping legacy Word attach-only", () => {
    expect(
      isAutoFillResumeMimeType(
        resumeMimeType({ name: "resume.pdf", type: "" }),
      ),
    ).toBe(true);
    expect(
      isAutoFillResumeMimeType(
        resumeMimeType({ name: "resume.docx", type: "" }),
      ),
    ).toBe(true);
    expect(
      isAutoFillResumeMimeType(
        resumeMimeType({ name: "resume.doc", type: "" }),
      ),
    ).toBe(false);
  });

  it("uses the partial-read copy when the worker leaves fields blank", () => {
    expect(resumeReadSuccessMessage({ name_en: "Rivky", age: null })).toMatch(
      /not everything/i,
    );
    expect(resumeReadSuccessMessage({ name_en: "Rivky", age: 24 })).toMatch(
      /review them before saving/i,
    );
  });

  it("maps worker and network failures to fixed plain-English messages", () => {
    expect(friendlyResumeReadError(new Error("resume appears empty"))).toMatch(
      /appears to be empty/i,
    );
    expect(
      friendlyResumeReadError(new Error("resume is password-protected")),
    ).toMatch(/password-protected/i);
    expect(friendlyResumeReadError(new Error("could not open resume"))).toMatch(
      /couldn’t open this Word file/i,
    );
    expect(friendlyResumeReadError(new Error("resume too long"))).toMatch(
      /too long/i,
    );
    expect(
      friendlyResumeReadError(new Error("monthly resume limit reached")),
    ).toBe(
      "You’ve reached your monthly resume-reading limit. Your file is still attached.",
    );
    expect(friendlyResumeReadError(new Error("Failed to fetch"))).toMatch(
      /couldn’t reach the resume reader/i,
    );
    expect(friendlyResumeReadError(new Error("429 rate limit"))).toMatch(
      /resume reader is busy/i,
    );
    expect(friendlyResumeReadError(new Error("invalid request body"))).toMatch(
      /couldn’t read that resume/i,
    );
    expect(friendlyResumeUploadError()).not.toMatch(/invalid|fetch|Error/i);
    expect(
      friendlySuggestionSubmitError(
        new Error(
          "Another resolution is already in progress for inbox item 700.",
        ),
      ),
    ).toMatch(/already started/i);
  });
});

import { describe, expect, it } from "vitest";

import {
  friendlyResumeReadError,
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

  it("maps worker and network failures to fixed plain-English messages", () => {
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

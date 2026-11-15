import { describe, expect, it } from "vitest";

import {
  MAX_INBOX_FILE_BYTES,
  validateInboxFile,
} from "./inboxAttachmentValidation";

const fileFromBytes = (bytes: number[], name: string, type: string): File =>
  new File([new Uint8Array(bytes)], name, { type });

describe("validateInboxFile", () => {
  it("accepts supported PDF, Word, and picture files with their display kinds", async () => {
    await expect(
      validateInboxFile(
        fileFromBytes(
          [0x25, 0x50, 0x44, 0x46, 0x2d],
          "resume.pdf",
          "application/pdf",
        ),
      ),
    ).resolves.toMatchObject({ ok: true, kind: "Resume" });
    await expect(
      validateInboxFile(
        fileFromBytes(
          [0x50, 0x4b, 0x03, 0x04],
          "resume.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).resolves.toMatchObject({ ok: true, kind: "Resume" });
    await expect(
      validateInboxFile(
        fileFromBytes([0xff, 0xd8, 0xff], "picture.jpg", "image/jpeg"),
      ),
    ).resolves.toMatchObject({ ok: true, kind: "Picture" });
    await expect(
      validateInboxFile(fileFromBytes([0xff, 0xd8, 0xff], "picture.jpg", "")),
    ).resolves.toMatchObject({
      ok: true,
      kind: "Picture",
      mimeType: "image/jpeg",
    });
    await expect(
      validateInboxFile(
        fileFromBytes(
          [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
          "picture.heic",
          "",
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: "Picture",
      mimeType: "image/heic",
    });
  });

  it("rejects a mislabeled file instead of trusting the MIME type", async () => {
    await expect(
      validateInboxFile(
        fileFromBytes(
          [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e],
          "resume.pdf",
          "application/pdf",
        ),
      ),
    ).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects unsupported types and files over the named 8 MiB limit", async () => {
    await expect(
      validateInboxFile(
        new File(["hello"], "notes.txt", { type: "text/plain" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "unsupported" });

    const tooBig = new File(
      [new Uint8Array(MAX_INBOX_FILE_BYTES + 1)],
      "large.pdf",
      { type: "application/pdf" },
    );
    await expect(validateInboxFile(tooBig)).resolves.toEqual({
      ok: false,
      reason: "too_big",
    });
  });
});

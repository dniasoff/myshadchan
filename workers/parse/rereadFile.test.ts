import { describe, expect, it } from "vitest";

import {
  readRereadResumeRow,
  selectRereadFile,
  validateDownloadedRereadFile,
} from "./rereadFile";

const pdfBytes = new TextEncoder().encode("%PDF-1.7").buffer;

function resume(overrides: Record<string, unknown> = {}) {
  return {
    id: 22,
    account_id: 10,
    shidduchim_id: 33,
    single_id: null,
    sections: { references: [{ name: "unchanged" }] },
    files: [
      {
        path: "10/resumes/33/old.pdf",
        filename: "old.pdf",
        uploaded_at: "2026-01-01T00:00:00.000Z",
        mime_type: "application/pdf",
        size: pdfBytes.byteLength,
      },
      {
        path: "10/resumes/33/new.pdf",
        filename: "new.pdf",
        uploaded_at: "2026-02-01T00:00:00.000Z",
        mime_type: "application/pdf",
        size: pdfBytes.byteLength,
      },
    ],
    ...overrides,
  };
}

describe("re-read resume file guards", () => {
  it("accepts a parsed row and selects the newest file", () => {
    const parsed = readRereadResumeRow(resume());
    expect(parsed).not.toBeNull();
    expect(selectRereadFile(parsed!, 10)).toEqual({
      file: expect.objectContaining({ path: "10/resumes/33/new.pdf" }),
      dirPath: "10/resumes/33",
      fileName: "new.pdf",
    });
  });

  it.each([
    ["wrong account", "99/resumes/33/new.pdf"],
    ["wrong owner", "10/resumes/44/new.pdf"],
    ["path traversal", "10/resumes/33/../new.pdf"],
  ])("rejects %s storage paths before service-role access", (_name, path) => {
    const parsed = readRereadResumeRow(
      resume({ files: [{ ...resume().files![0], path }] }),
    );
    expect(selectRereadFile(parsed!, 10)).toBeNull();
  });

  it("rejects ambiguous ownership and unsupported or oversized files", () => {
    expect(
      selectRereadFile(readRereadResumeRow(resume({ single_id: 44 }))!, 10),
    ).toBeNull();
    expect(
      selectRereadFile(
        readRereadResumeRow(
          resume({
            files: [
              {
                ...resume().files![0],
                mime_type: "application/octet-stream",
              },
            ],
          }),
        )!,
        10,
      ),
    ).toBeNull();
    expect(
      selectRereadFile(
        readRereadResumeRow(
          resume({
            files: [{ ...resume().files![0], size: 8 * 1024 * 1024 + 1 }],
          }),
        )!,
        10,
      ),
    ).toBeNull();
  });

  it("bounds the downloaded bytes and verifies their magic", () => {
    expect(validateDownloadedRereadFile(pdfBytes, "application/pdf")).toBe(
      true,
    );
    expect(
      validateDownloadedRereadFile(
        new TextEncoder().encode("not a PDF").buffer,
        "application/pdf",
      ),
    ).toBe(false);
    expect(
      validateDownloadedRereadFile(
        new ArrayBuffer(8 * 1024 * 1024 + 1),
        "application/pdf",
      ),
    ).toBe(false);
  });
});

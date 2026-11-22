import { describe, expect, it } from "vitest";

import {
  CHILD_DOCUMENT_MAX_BYTES,
  MAX_CHILD_DOCUMENTS,
  MAX_CHILD_PAPERS,
  validateChildDocument,
} from "./childDocuments";

function file(name: string, type: string, size = 1): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("child document policy", () => {
  it("keeps the four-file and two-paper limits explicit", () => {
    expect(MAX_CHILD_DOCUMENTS).toBe(4);
    expect(MAX_CHILD_PAPERS).toBe(2);
  });

  it.each([
    ["resume.pdf", "application/pdf"],
    ["resume.doc", "application/msword"],
    [
      "resume.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["picture.jpg", "image/jpeg"],
    ["picture.png", "image/png"],
  ])("accepts %s", (name, type) => {
    expect(validateChildDocument(file(name, type))).toBeNull();
  });

  it("accepts exactly 8 MiB and rejects a larger file", () => {
    expect(
      validateChildDocument(
        file("paper.pdf", "application/pdf", CHILD_DOCUMENT_MAX_BYTES),
      ),
    ).toBeNull();
    expect(
      validateChildDocument(
        file("paper.pdf", "application/pdf", CHILD_DOCUMENT_MAX_BYTES + 1),
      ),
    ).toContain("8 MiB");
  });

  it("rejects unsupported types instead of relying on the picker filter", () => {
    expect(validateChildDocument(file("paper.txt", "text/plain"))).toContain(
      "PDF, Word, JPEG, or PNG",
    );
    expect(validateChildDocument(file("paper.svg", "image/svg+xml"))).toContain(
      "PDF, Word, JPEG, or PNG",
    );
  });

  it("still accepts a browser file whose MIME type is blank when its safe extension is known", () => {
    expect(validateChildDocument(file("paper.pdf", ""))).toBeNull();
  });
});

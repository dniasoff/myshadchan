import { describe, expect, it } from "vitest";

import type { InboxAttachment, InboxItem, ResumeFileVersion } from "../types";
import {
  flattenEligibleResumeAttachments,
  isEligibleResumeAttachment,
  toResumeInboxPickerItem,
} from "./resumeInbox";

const attachment = (
  overrides: Partial<InboxAttachment> = {},
): InboxAttachment => ({
  title: "resume.pdf",
  type: "application/pdf",
  path: "1/inbox/1/resume.pdf",
  src: "https://signed.example/resume.pdf",
  ...overrides,
});

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 1,
  created_at: "2026-11-14T10:00:00.000Z",
  source: "whatsapp",
  sender: "Rivky's aunt",
  sender_needs_confirmation: false,
  attachments: [attachment()],
  status: "unresolved",
  ...overrides,
});

describe("resume Inbox eligibility", () => {
  it("projects picker data without Inbox message text or signed URLs", () => {
    const projected = toResumeInboxPickerItem(
      item({ raw_text: "private message text" }),
    );

    expect(projected).not.toHaveProperty("raw_text");
    expect(projected.attachments?.[0]).not.toHaveProperty("src");
    expect(JSON.stringify(projected)).not.toContain("private message text");
    expect(JSON.stringify(projected)).not.toContain("signed.example");
  });

  it.each([
    ["application/pdf", "resume"],
    ["application/msword", "resume.doc"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "resume.docx",
    ],
    ["image/jpeg", "photo.jpg"],
    ["image/png", "photo.png"],
    ["", "resume.PDF"],
    ["", "resume.DOC"],
    ["", "resume.docx"],
    ["", "photo.HEIC"],
  ])("accepts %s with filename %s", (type, title) => {
    expect(isEligibleResumeAttachment(attachment({ type, title }))).toBe(true);
  });

  it.each([
    ["text/plain", "resume.txt"],
    ["application/zip", "resume.zip"],
    ["", "no-extension"],
    ["application/pdf", "missing-path.pdf", ""],
  ])("rejects %s %s", (type, title, path = "1/inbox/1/resume.pdf") => {
    expect(isEligibleResumeAttachment(attachment({ type, title, path }))).toBe(
      false,
    );
  });

  it("flattens one row per attachment, excludes non-working captures, and marks provenance duplicates", () => {
    const eligible = attachment({
      title: "resume-2.docx",
      type: "",
      path: "1/inbox/1/resume-2.docx",
    });
    const files = [
      {
        path: "1/resumes/42/inbox-source.pdf",
        filename: "old.pdf",
        uploaded_at: "2026-11-14T11:00:00.000Z",
        uploaded_by: 7,
        mime_type: "application/pdf",
        size: 12,
        source_inbox_item_id: 1,
        source_inbox_attachment_path: "1/inbox/1/resume.pdf",
      },
    ] satisfies ResumeFileVersion[];
    const rows = flattenEligibleResumeAttachments(
      [
        item({ attachments: [attachment(), eligible] }),
        item({ id: 2, status: "held" }),
        item({ id: 3, status: "resolving" }),
        item({ id: 4, status: "resolved" }),
        item({ id: 5, status: "dismissed" }),
        item({ id: 6, attachments: [attachment({ type: "text/plain" })] }),
      ],
      files,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      inboxItemId: 1,
      title: "resume.pdf",
      sourceLabel: "Rivky's aunt",
      receivedAt: "2026-11-14T10:00:00.000Z",
      alreadyAttached: true,
    });
    expect(rows[1]).toMatchObject({
      inboxItemId: 1,
      title: "resume-2.docx",
      alreadyAttached: false,
    });
  });

  it("uses the safe phone-share label when the sender is absent", () => {
    const [row] = flattenEligibleResumeAttachments(
      [item({ sender: null, sender_email: null })],
      [],
    );
    expect(row.sourceLabel).toBe("Shared from your phone");
  });
});

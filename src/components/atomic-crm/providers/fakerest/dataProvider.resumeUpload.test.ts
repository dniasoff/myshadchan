import { describe, expect, it } from "vitest";

import { createDataProvider } from "./dataProvider";

describe("FakeRest resume capture methods", () => {
  it("uploads, copies, and removes a captured resume", async () => {
    const dataProvider = createDataProvider({ latency: 0, silent: true });
    const file = new File(["resume bytes"], "resume.pdf", {
      type: "application/pdf",
    });

    const attachment = await dataProvider.uploadInboxAttachment({
      file,
      inboxItemId: 700,
    });
    expect(attachment.path).toMatch(/\/inbox\/700\//);
    expect(attachment.type).toBe("application/pdf");

    const copied = await dataProvider.copyInboxAttachmentToResumeFile({
      shidduchimId: 99,
      attachment,
    });
    expect(copied.size).toBe(file.size);

    await dataProvider.removeResumeFileObjects([copied.storagePath]);
    await dataProvider.removeInboxAttachment(attachment.path);
  });
});

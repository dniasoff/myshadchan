import { describe, expect, it } from "vitest";

describe("Android share target", () => {
  it("advertises images and resume document MIME types", async () => {
    const manifest = (await fetch("/manifest.json").then((response) =>
      response.json(),
    )) as {
      share_target: { params: { files: Array<{ accept: string[] }> } };
    };
    const accept = manifest.share_target.params.files[0]?.accept;
    expect(accept).toEqual([
      "image/*",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });
});

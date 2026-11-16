import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { InboxItem } from "../types";
import { InboxResumeActionButtons } from "./InboxResumeActions";

const item = (attachments: InboxItem["attachments"]): InboxItem => ({
  id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "upload",
  sender_needs_confirmation: false,
  attachments,
  status: "unresolved",
});

const documentAttachment = {
  title: "resume.pdf",
  type: "application/pdf",
  path: "1/inbox/resume.pdf",
  src: "https://example.test/resume.pdf",
};

describe("Inbox resume action buttons", () => {
  it("offers exactly the two approved actions for a resume document", async () => {
    const onChoose = vi.fn();
    const screen = await render(
      <InboxResumeActionButtons
        item={item([documentAttachment])}
        enabled
        onChoose={onChoose}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Attach to a suggestion" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Make a new suggestion" }))
      .toBeEnabled();

    await screen.getByRole("button", { name: "Make a new suggestion" }).click();
    expect(onChoose).toHaveBeenCalledWith("new");
  });

  it("disables both actions with the safe file-first copy for picture-only items", async () => {
    const screen = await render(
      <InboxResumeActionButtons
        item={item([
          {
            title: "photo.jpg",
            type: "image/jpeg",
            path: "1/inbox/photo.jpg",
            src: "https://example.test/photo.jpg",
          },
        ])}
        enabled
        onChoose={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: /Attach to a suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /Make a new suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Add a resume file first."))
      .toBeInTheDocument();
  });

  it("keeps held items disabled until the sender is trusted", async () => {
    const screen = await render(
      <InboxResumeActionButtons
        item={item([documentAttachment])}
        enabled={false}
        onChoose={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: /Attach to a suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Trust sender first."))
      .toBeInTheDocument();
  });
});

import { render } from "vitest-browser-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharedProfilePage } from "./SharedProfilePage";
import type { SharedProfileData } from "./shareClient";
import type { ShareUrl } from "./shareToken";

/**
 * Pins the shared-profile page's fail-soft contract, mirroring the retired
 * token-portal page's own three-state test shape (Epic 1 Story 1.4 — that
 * suite is gone; read it from git history): a valid token renders the calm
 * read-only view; a missing, unknown, revoked, or errored token all
 * resolve to the SAME neutral "no longer active" notice — never a crash and
 * never a detail leak (AC-7's no-oracle rule, extended to the client).
 */

const shareUrl = (token = "a-valid-looking-token"): ShareUrl => ({
  pathname: "/share",
  search: "",
  hash: `#${token}`,
});

const activeData: SharedProfileData = {
  single: { first_name_en: "Rivky", first_name_he: "רבקה" },
  files: [
    {
      fileKey: "resume-0",
      filename: "resume.pdf",
      mimeType: "application/pdf",
      size: 1234,
      downloadUrl: "/r/tok/file/resume-0",
    },
  ],
};

describe("SharedProfilePage", () => {
  // The active-state renders build a downloadUrl through
  // shareClient.ts#resolveShareFileUrl, which reads VITE_SHARE_WORKER_URL —
  // set for every test in this suite so an unrelated, unconfigured-env
  // failure never masquerades as a component bug.
  beforeEach(() => {
    vi.stubEnv("VITE_SHARE_WORKER_URL", "https://share.myshadchan.test");
  });

  it("renders the single's profile and a download link for a valid token", async () => {
    // Arrange / Act
    const screen = await render(
      <SharedProfilePage
        url={shareUrl()}
        loadProfile={() => Promise.resolve(activeData)}
      />,
    );

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Rivky's profile");
    await expect.element(screen.getByText("resume.pdf")).toBeVisible();
  });

  it("shows a calm empty state when there are no files", async () => {
    // Arrange / Act
    const screen = await render(
      <SharedProfilePage
        url={shareUrl()}
        loadProfile={() =>
          Promise.resolve({
            single: { first_name_en: "Rivky", first_name_he: null },
            files: [],
          })
        }
      />,
    );

    // Assert
    await expect
      .element(screen.getByText(/No resume has been shared here yet/i))
      .toBeVisible();
  });

  it("shows the inactive notice when the token resolves to null (revoked/unknown/expired)", async () => {
    // Arrange / Act
    const screen = await render(
      <SharedProfilePage
        url={shareUrl()}
        loadProfile={() => Promise.resolve(null)}
      />,
    );

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
  });

  it("shows the inactive notice when no token is present, without calling the loader", async () => {
    // Arrange
    const loadProfile = vi.fn(() => Promise.resolve(activeData));

    // Act
    const screen = await render(
      <SharedProfilePage
        url={{ pathname: "/share", search: "", hash: "" }}
        loadProfile={loadProfile}
      />,
    );

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it("fails soft to the inactive notice on a loader error", async () => {
    // Arrange / Act
    const screen = await render(
      <SharedProfilePage
        url={shareUrl()}
        loadProfile={() => Promise.reject(new Error("network"))}
      />,
    );

    // Assert
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This link is no longer active");
  });

  it("renders the photo inline (never as a downloadable resume row) when include_photo produced one", async () => {
    // Arrange
    const withPhoto: SharedProfileData = {
      single: { first_name_en: "Rivky", first_name_he: null },
      files: [
        ...activeData.files,
        {
          fileKey: "photo",
          filename: null,
          mimeType: null,
          size: null,
          downloadUrl: "/r/tok/file/photo",
        },
      ],
    };

    // Act
    const screen = await render(
      <SharedProfilePage
        url={shareUrl()}
        loadProfile={() => Promise.resolve(withPhoto)}
      />,
    );

    // Assert — the photo renders as an <img>, and the resume file still
    // renders as its own separate download row (not merged/hidden).
    await expect.element(screen.getByRole("img")).toBeVisible();
    await expect.element(screen.getByText("resume.pdf")).toBeVisible();
  });
});

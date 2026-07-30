import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ResumePhoto } from "../types";
import { PhotoRevealCard } from "./PhotoRevealCard";

/**
 * Story 5.4's falsifiable claims for `PhotoRevealCard`: nothing is fetched
 * or placed in the DOM before the reveal click (AC 1), the click mints a
 * signed URL and shows the image, and Hide calls the sole soft-hide write
 * path (AC 2) — never a DELETE.
 */

const buildPhoto = (overrides: Partial<ResumePhoto> = {}): ResumePhoto => ({
  id: 1,
  account_id: 1,
  resume_id: 1,
  path: "1/photos/shared/7/abc-photo.jpg",
  uploaded_at: "2026-01-01T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    signResumePhotoUrl: vi
      .fn()
      .mockResolvedValue("https://signed.example/photo.jpg"),
    hideResumePhoto: vi.fn().mockResolvedValue(buildPhoto()),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderCard = async (
  photo: ResumePhoto,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  const onHidden = vi.fn();

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <PhotoRevealCard photo={photo} onHidden={onHidden} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, onHidden };
};

describe("PhotoRevealCard — hidden by default (AC 1)", () => {
  it("renders a Reveal button and no image, with no signed URL requested yet", async () => {
    // Arrange
    const signResumePhotoUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/x");

    // Act
    const { screen } = await renderCard(buildPhoto(), { signResumePhotoUrl });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Reveal" }))
      .toBeInTheDocument();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(signResumePhotoUrl).not.toHaveBeenCalled();
  });

  it("shows the photo's visibility label", async () => {
    // Act
    const { screen } = await renderCard(
      buildPhoto({ visibility: "private_parent" }),
    );

    // Assert
    await expect.element(screen.getByText("Parents only")).toBeInTheDocument();
  });
});

describe("PhotoRevealCard — reveal click (AC 1)", () => {
  it("signs the photo's own path and shows the image", async () => {
    // Arrange
    const photo = buildPhoto({ path: "1/photos/shared/7/xyz.jpg" });
    const signResumePhotoUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/xyz.jpg");

    // Act
    const { screen } = await renderCard(photo, { signResumePhotoUrl });
    await screen.getByRole("button", { name: "Reveal" }).click();

    // Assert
    expect(signResumePhotoUrl).toHaveBeenCalledExactlyOnceWith({
      storagePath: "1/photos/shared/7/xyz.jpg",
    });
    await expect
      .poll(() => screen.container.querySelector("img")?.getAttribute("src"))
      .toBe("https://signed.example/xyz.jpg");
  });

  it("shows a translated error and stays revealable when signing rejects", async () => {
    // Arrange
    const signResumePhotoUrl = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderCard(buildPhoto(), { signResumePhotoUrl });
    await screen.getByRole("button", { name: "Reveal" }).click();

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Reveal" }))
      .toBeInTheDocument();
    expect(screen.container.querySelector("img")).toBeNull();
  });
});

describe("PhotoRevealCard — hide (AC 2)", () => {
  it("calls hideResumePhoto with the photo's id and notifies the parent", async () => {
    // Arrange
    const photo = buildPhoto({ id: 42 });
    const hideResumePhoto = vi.fn().mockResolvedValue(buildPhoto({ id: 42 }));

    // Act
    const { screen, onHidden } = await renderCard(photo, { hideResumePhoto });
    await screen.getByRole("button", { name: "Hide" }).click();

    // Assert
    expect(hideResumePhoto).toHaveBeenCalledExactlyOnceWith({ id: 42 });
    await expect.poll(() => onHidden.mock.calls.length).toBe(1);
  });

  it("shows a translated error and stays usable when hiding rejects", async () => {
    // Arrange
    const hideResumePhoto = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen, onHidden } = await renderCard(buildPhoto(), {
      hideResumePhoto,
    });
    await screen.getByRole("button", { name: "Hide" }).click();

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    expect(onHidden).not.toHaveBeenCalled();
  });
});

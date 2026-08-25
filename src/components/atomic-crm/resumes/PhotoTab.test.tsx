import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { Resume, ResumePhoto } from "../types";
import { PhotoTab } from "./PhotoTab";

/**
 * Story 5.4's AD-10 mirror check: `PhotoTab` composes an upload control and
 * a grid of `PhotoRevealCard`s that only talk to each other through
 * `useRefresh()`'s global query invalidation — a real FakeRest provider,
 * not a mock, is what actually exercises the two-step `resumes` ->
 * `resume_photos` lookup and the upload/hide round trip.
 */

const renderTab = async (
  shidduchimId: number,
  photoRevealOnClick = false,
  failure: "account" | "contexts" | "none" = "none",
) => {
  const db = generateData();
  db.resumes = [] as Resume[];
  db.resume_photos = [] as ResumePhoto[];
  db.accounts[0].photo_reveal_on_click = photoRevealOnClick;
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  if (failure === "account") {
    dataProvider.getOne = vi.fn(async (resource: string) => {
      if (resource === "accounts") throw new Error("account lookup failed");
      throw new Error(`unexpected getOne(${resource})`);
    }) as typeof dataProvider.getOne;
  }
  if (failure === "contexts") {
    dataProvider.getMyContexts = vi.fn(async () => {
      throw new Error("context lookup failed");
    });
  }

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={{ id: shidduchimId }}>
          <PhotoTab />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("PhotoTab — empty state and visibility default (AC 1 / AC 2)", () => {
  it("shows the empty state when no photo has been uploaded yet", async () => {
    // Act
    const { screen } = await renderTab(1);

    // Assert
    await expect
      .element(screen.getByText("No photos uploaded yet."))
      .toBeInTheDocument();
  });

  it("preselects the 'Shared' visibility option", async () => {
    // Act
    const { screen } = await renderTab(1);

    // Assert
    await expect
      .element(screen.getByRole("radio", { name: "Shared" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("radio", { name: "Parents only" }))
      .not.toBeChecked();
  });
});

describe("PhotoTab — configurable photo display", () => {
  it("shows uploaded photos immediately by default", async () => {
    // Arrange
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    // Act
    const { screen, dataProvider } = await renderTab(7);
    const signResumePhotoUrl = vi.spyOn(dataProvider, "signResumePhotoUrl");
    await screen.getByLabelText("Upload a photo").upload(file);

    // Assert — the new default is ordinary photo display.
    await expect
      .poll(() => screen.container.querySelector("img"))
      .not.toBeNull();
    expect(signResumePhotoUrl).toHaveBeenCalledTimes(1);
    await expect
      .element(screen.getByRole("button", { name: "Reveal" }))
      .not.toBeInTheDocument();
  });

  it("keeps photos behind Reveal when the account preference is enabled", async () => {
    // Arrange
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    // Act
    const { screen, dataProvider } = await renderTab(8, true);
    const signResumePhotoUrl = vi.spyOn(dataProvider, "signResumePhotoUrl");
    await screen.getByLabelText("Upload a photo").upload(file);

    // Assert — enabled preference preserves the original deliberate-friction
    // behavior and does not sign before the click.
    await expect
      .element(screen.getByRole("button", { name: "Reveal" }))
      .toBeInTheDocument();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(signResumePhotoUrl).not.toHaveBeenCalled();

    // Act — reveal.
    await screen.getByRole("button", { name: "Reveal" }).click();

    // Assert — the image now renders and exactly one signed URL was minted.
    await expect
      .poll(() => screen.container.querySelector("img"))
      .not.toBeNull();
    expect(signResumePhotoUrl).toHaveBeenCalledExactlyOnceWith({
      storagePath: expect.stringContaining("/photos/shared/8/"),
    });
  });

  it.each(["account", "contexts"] as const)(
    "fails closed when the %s privacy lookup errors",
    async (failure) => {
      const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
      const { screen, dataProvider } = await renderTab(10, false, failure);
      const signResumePhotoUrl = vi.spyOn(dataProvider, "signResumePhotoUrl");

      await screen.getByLabelText("Upload a photo").upload(file);

      await expect
        .element(screen.getByRole("button", { name: "Reveal" }))
        .toBeInTheDocument();
      expect(screen.container.querySelector("img")).toBeNull();
      expect(signResumePhotoUrl).not.toHaveBeenCalled();
    },
  );

  it("uploads with the private_parent visibility option when selected", async () => {
    // Arrange
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    // Act
    const { screen, dataProvider } = await renderTab(9);
    await screen.getByRole("radio", { name: "Parents only" }).click();
    await screen.getByLabelText("Upload a photo").upload(file);

    // Assert
    const { data } = await dataProvider.getList<ResumePhoto>("resume_photos", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(1);
    expect(data[0].visibility).toBe("private_parent");
  });
});

describe("PhotoTab — hide removes a photo from the grid (AC 2)", () => {
  it("hides a photo and it no longer appears, without ever deleting the row", async () => {
    // Arrange
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    // Act
    const { screen, dataProvider } = await renderTab(3);
    await screen.getByLabelText("Upload a photo").upload(file);
    await expect
      .poll(() => screen.container.querySelector("img"))
      .not.toBeNull();

    // Hiding is irreversible (there is no UPDATE policy that could clear
    // `hidden_at` again), so the card asks first — see `PhotoRevealCard`.
    await screen.getByRole("button", { name: "Hide" }).click();
    await screen.getByRole("button", { name: "Hide photo" }).click();

    // Assert — the reveal card is gone and the empty state returns...
    await expect
      .element(screen.getByText("No photos uploaded yet."))
      .toBeInTheDocument();

    // ...but the row itself still exists, hidden_at set (soft-hide, AC 2).
    const { data } = await dataProvider.getList<ResumePhoto>("resume_photos", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(1);
    expect(data[0].hidden_at).not.toBeNull();
  });
});

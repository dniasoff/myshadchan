import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getShareWorkerUrl,
  loadSharedProfile,
  resolveShareFileUrl,
  type SharedProfileData,
} from "./shareClient";

const BASE_URL = "https://share.myshadchan.workers.dev";

const activeData: SharedProfileData = {
  single: { first_name_en: "Rivky", first_name_he: "רבקה" },
  files: [
    {
      fileKey: "resume-0",
      filename: "resume.pdf",
      mimeType: "application/pdf",
      size: 1234,
      downloadUrl: "/r/tok123/file/resume-0",
    },
  ],
};

describe("loadSharedProfile", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the profile data for a valid token", async () => {
    // Arrange
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: activeData }),
    });

    // Act
    const result = await loadSharedProfile("tok123", BASE_URL);

    // Assert
    expect(result).toEqual(activeData);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${BASE_URL}/r/tok123`);
  });

  it("URL-encodes the token before building the request", async () => {
    // Arrange
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ success: false }),
    });

    // Act
    await loadSharedProfile("a/b c", BASE_URL);

    // Assert
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${BASE_URL}/r/a%2Fb%20c`,
    );
  });

  it("resolves to null on a 404 (unknown, revoked, or expired token — AC-7's no-oracle rule)", async () => {
    // Arrange
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ success: false, error: "not found" }),
    });

    // Act
    const result = await loadSharedProfile("dead-token", BASE_URL);

    // Assert
    expect(result).toBeNull();
  });

  it("resolves to null when the envelope reports success: false without a 404 status", async () => {
    // Arrange
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: false }),
    });

    // Act
    const result = await loadSharedProfile("tok123", BASE_URL);

    // Assert
    expect(result).toBeNull();
  });

  it("throws on a non-404 error response — a genuine transport/config failure", async () => {
    // Arrange
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ success: false }),
    });

    // Act / Assert
    await expect(loadSharedProfile("tok123", BASE_URL)).rejects.toThrow();
  });

  it("throws when the Worker URL is not configured and no baseUrl is given", async () => {
    // Act / Assert — getShareWorkerUrl() itself throws when unset; the test
    // env has no VITE_SHARE_WORKER_URL, so the default parameter throws
    // before fetch is ever called.
    await expect(loadSharedProfile("tok123")).rejects.toThrow(
      "Share Worker URL is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveShareFileUrl", () => {
  it("prefixes the manifest's own downloadUrl with the Worker's origin", () => {
    // Arrange / Act
    const url = resolveShareFileUrl("/r/tok123/file/resume-0", BASE_URL);

    // Assert
    expect(url).toBe(`${BASE_URL}/r/tok123/file/resume-0`);
  });
});

describe("getShareWorkerUrl", () => {
  it("throws a clear error when VITE_SHARE_WORKER_URL is unset", () => {
    // Act / Assert
    expect(() => getShareWorkerUrl()).toThrow(
      "Share Worker URL is not configured",
    );
  });
});

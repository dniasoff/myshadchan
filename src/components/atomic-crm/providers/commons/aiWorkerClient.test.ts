import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAiWorker } from "./aiWorkerClient";

const getSession = vi.fn();

vi.mock("../supabase/supabase", () => ({
  getSupabaseClient: () => ({
    auth: { getSession },
  }),
}));

describe("callAiWorker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the bearer token from the current session", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { parsed: true } }),
    });

    // Act
    const result = await callAiWorker("http://localhost/parse", {
      inbox_item_id: 1,
    });

    // Assert
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/parse",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-abc",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inbox_item_id: 1 }),
      }),
    );
    expect(result).toEqual({ parsed: true });
  });

  it("throws the server's error string on success:false", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: "monthly resume limit reached",
        }),
    });

    // Act / Assert
    await expect(
      callAiWorker("http://localhost/parse", { inbox_item_id: 1 }),
    ).rejects.toThrow("monthly resume limit reached");
  });

  it("propagates a rejected fetch", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockRejectedValue(new Error("Network failure"));

    // Act / Assert
    await expect(
      callAiWorker("http://localhost/parse", { inbox_item_id: 1 }),
    ).rejects.toThrow("Network failure");
  });
});

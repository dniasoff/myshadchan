import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callEmailWorker } from "./emailWorkerClient";

const getSession = vi.fn();
vi.mock("../supabase/supabase", () => ({
  getSupabaseClient: () => ({ auth: { getSession } }),
}));

describe("callEmailWorker", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the current bearer token and only the opaque send body", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { status: "accepted" } }),
        {
          status: 200,
        },
      ),
    );

    await expect(
      callEmailWorker("http://email.local/", {
        single_id: 7,
        shadchan_id: 8,
        include_photo: true,
        request_id: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://email.local/send",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token-abc",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("does not call the Worker without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(callEmailWorker("http://email.local", {})).rejects.toThrow(
      "Not authenticated",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

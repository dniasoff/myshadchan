import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  requestResumeRead,
  requestResumeReread,
  REREAD_REQUEST_TIMEOUT_MS,
} from "./rereadWorkerClient";

const getSession = vi.fn();
vi.mock("../supabase/supabase", () => ({
  getSupabaseClient: () => ({ auth: { getSession } }),
}));

describe("requestResumeReread", () => {
  beforeEach(() => {
    getSession.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls the live parse route with only the numeric resume and opaque request id", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { replayed: false } }),
        {
          status: 200,
        },
      ),
    );

    await expect(
      requestResumeReread("http://parse.local/", {
        resumeId: "22",
        requestId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("completed");
    expect(fetch).toHaveBeenCalledWith(
      "http://parse.local/parse",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token-abc",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resume_id: 22,
          request_id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("sends the exact file identity for fill-empty reads", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { empty: true } }), {
        status: 200,
      }),
    );

    await expect(
      requestResumeRead("http://parse.local", {
        resumeId: 22,
        requestId: "00000000-0000-4000-8000-000000000002",
        mode: "fill_empty",
        fileIdentity: "10/resumes/22/current.pdf",
      }),
    ).resolves.toBe("empty");
    expect(fetch).toHaveBeenCalledWith(
      "http://parse.local/parse",
      expect.objectContaining({
        body: JSON.stringify({
          resume_id: 22,
          request_id: "00000000-0000-4000-8000-000000000002",
          mode: "fill_empty",
          file_identity: "10/resumes/22/current.pdf",
        }),
      }),
    );
  });

  it.each([
    [402, {}, "no_allowance"],
    [402, { code: "not_entitled" }, "not_entitled"],
    [409, { code: "already_reading" }, "already_reading"],
    [409, {}, "failed"],
    [503, {}, "failed"],
  ] as const)(
    "maps status %s without exposing server copy",
    async (status, meta, outcome) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: "private server detail must not reach the UI",
            meta,
          }),
          { status },
        ),
      );

      await expect(
        requestResumeReread("http://parse.local", {
          resumeId: 22,
          requestId: "00000000-0000-4000-8000-000000000001",
        }),
      ).resolves.toBe(outcome);
    },
  );

  it("fails closed for missing sessions, transport errors and malformed envelopes", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(
      requestResumeReread("http://parse.local", {
        resumeId: 22,
        requestId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("failed");
    expect(fetch).not.toHaveBeenCalled();

    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(
      requestResumeReread("http://parse.local", {
        resumeId: 22,
        requestId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("failed");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("gateway html", { status: 502 }),
    );
    await expect(
      requestResumeReread("http://parse.local", {
        resumeId: 22,
        requestId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("failed");
  });

  it("aborts a hung fetch at the named client deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = requestResumeReread("http://parse.local", {
      resumeId: 22,
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    await vi.advanceTimersByTimeAsync(REREAD_REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toBe("failed");
  });

  it("honors an abort signal from the unmounted control", async () => {
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = requestResumeReread("http://parse.local", {
      resumeId: 22,
      requestId: "00000000-0000-4000-8000-000000000001",
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toBe("failed");
  });
});

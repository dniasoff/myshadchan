import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExtractorProviderError,
  ExtractorTimeoutError,
  GEMINI_EXTRACT_TIMEOUT_MS,
  geminiExtractor,
} from "./resumeExtractor";
import { GEMINI_RESUME_RESPONSE_SCHEMA } from "./geminiResponseSchema";
import { TEST_ENV } from "./parseTestFixtures";

describe("geminiExtractor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the Gemini gateway with the floating gemini-flash-latest alias, not a pinned version", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const extractor = geminiExtractor(TEST_ENV);

    // Act
    await extractor.extract(new ArrayBuffer(0), "application/pdf");

    // Assert
    expect(fetchMock).toHaveBeenCalledWith(
      `https://gateway.ai.cloudflare.com/v1/${TEST_ENV.AI_GATEWAY_ACCOUNT_ID}/${TEST_ENV.AI_GATEWAY_ID}/google-ai-studio/v1beta/models/gemini-flash-latest:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  // Finding 14: an explicit structured-output schema, not prose alone.
  describe("Finding 14 — explicit responseSchema", () => {
    it("sends generationConfig.responseSchema matching GEMINI_RESUME_RESPONSE_SCHEMA exactly", async () => {
      // Arrange
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act
      await extractor.extract(new ArrayBuffer(0), "application/pdf");

      // Assert
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        generationConfig: { responseMimeType: string; responseSchema: unknown };
      };
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.generationConfig.responseSchema).toEqual(
        GEMINI_RESUME_RESPONSE_SCHEMA,
      );
    });

    it("does not throw when the parsed JSON does not conform to any particular field shape — extraction no longer gates on it", async () => {
      // Arrange — Finding 14's second half: the extractor itself is no
      // longer a validation gate. A response shaped nothing like a resume
      // draft (age as a description string, unknown extra keys) must still
      // come back as the raw parsed value, not throw.
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        age: { value: "not a valid age shape", confidence: 2 },
                        unexpectedField: 12345,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act
      const result = await extractor.extract(
        new ArrayBuffer(0),
        "application/pdf",
      );

      // Assert — passed through unchanged; toDraft() is where validation
      // now happens, per field.
      expect(result).toEqual({
        age: { value: "not a valid age shape", confidence: 2 },
        unexpectedField: 12345,
      });
    });

    it("still throws on genuinely invalid JSON text (JSON.parse's own failure, unrelated to Finding 14's removed gate)", async () => {
      // Arrange
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{not valid json" }] } }],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act / Assert
      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toThrow();
    });
  });

  // Finding 5: the response body must never enter a thrown Error's message.
  describe("Finding 5 — no provider response body in thrown errors", () => {
    it("throws ExtractorProviderError with only the status, never the response body, on a non-2xx response", async () => {
      // Arrange — a realistic provider rejection echoing PII back.
      const piiLadenBody = JSON.stringify({
        error: {
          message:
            "blocked: input for Chana Friedman <chana.friedman@example.com> violates policy",
        },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(piiLadenBody, { status: 400 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act
      let caught: unknown;
      try {
        await extractor.extract(new ArrayBuffer(0), "application/pdf");
      } catch (error) {
        caught = error;
      }

      // Assert
      expect(caught).toBeInstanceOf(ExtractorProviderError);
      const error = caught as ExtractorProviderError;
      expect(error.status).toBe(400);
      expect(error.message).toBe("Gemini extraction failed");
      expect(error.message).not.toContain("chana.friedman@example.com");
      expect(error.message).not.toContain("Chana Friedman");
      expect(JSON.stringify(error)).not.toContain("chana.friedman@example.com");
    });

    it("never calls response.text() on a failed response (the actual leak vector)", async () => {
      // Arrange — a Response whose .text() would throw if ever called,
      // proving the extractor genuinely never reads it (not merely
      // discarding the result afterward).
      const response = new Response("PII body", { status: 500 });
      vi.spyOn(response, "text").mockRejectedValue(
        new Error("text() should never be called"),
      );
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act / Assert
      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toBeInstanceOf(ExtractorProviderError);
      expect(response.text).not.toHaveBeenCalled();
    });
  });

  // Finding 7: a live-but-slow Gemini call must be bounded, well under the
  // database's 5-minute staleness window, and must surface distinguishably.
  describe("Finding 7 — Gemini fetch timeout", () => {
    it("passes an AbortSignal to fetch", async () => {
      // Arrange
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act
      await extractor.extract(new ArrayBuffer(0), "application/pdf");

      // Assert
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("throws a distinguishable ExtractorTimeoutError when fetch aborts due to timeout", async () => {
      // Arrange — simulates exactly what `AbortSignal.timeout()` produces
      // on firing, without waiting out a real 60s timer.
      const fetchMock = vi
        .fn()
        .mockRejectedValue(
          new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act
      let caught: unknown;
      try {
        await extractor.extract(new ArrayBuffer(0), "application/pdf");
      } catch (error) {
        caught = error;
      }

      // Assert
      expect(caught).toBeInstanceOf(ExtractorTimeoutError);
      expect((caught as ExtractorTimeoutError).timeoutMs).toBe(
        GEMINI_EXTRACT_TIMEOUT_MS,
      );
      expect((caught as Error).message).toBe("Gemini extraction timed out");
    });

    it("is configured meaningfully shorter than the database's 5-minute staleness window", () => {
      // Assert — a live extraction must never be reclaimable underneath
      // itself (Finding 7's whole point). 5 minutes = 300_000ms.
      expect(GEMINI_EXTRACT_TIMEOUT_MS).toBeLessThan(300_000 / 2);
    });

    it("rethrows a non-timeout fetch failure unchanged (a genuine network error, not a timeout)", async () => {
      // Arrange
      const networkError = new TypeError("fetch failed");
      const fetchMock = vi.fn().mockRejectedValue(networkError);
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      // Act / Assert
      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toBe(networkError);
    });
  });
});

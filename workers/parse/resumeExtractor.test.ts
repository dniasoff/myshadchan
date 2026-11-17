import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  ExtractorProviderError,
  ExtractorProviderBusyError,
  ExtractorTimeoutError,
  GEMINI_FALLBACK_MAX_PROVIDER_REQUESTS,
  GEMINI_MAX_TOTAL_PROVIDER_REQUESTS,
  GEMINI_PRIMARY_MAX_PROVIDER_REQUESTS,
  GEMINI_RETRY_AFTER_CAP_MS,
  GEMINI_RETRY_INITIAL_BACKOFF_MS,
  GEMINI_RETRY_MAX_BACKOFF_MS,
  GEMINI_RETRY_OVERALL_BUDGET_MS,
  GEMINI_EXTRACT_TIMEOUT_MS,
  GEMINI_FALLBACK_MAX_ATTEMPT_TIMEOUT_MS,
  GEMINI_MAX_OUTPUT_TOKENS,
  DOCX_MIME_TYPE,
  geminiExtractor,
} from "./resumeExtractor";
import {
  GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA,
  GEMINI_RESUME_RESPONSE_SCHEMA,
} from "./geminiResponseSchema";
import {
  FULL_RESUME_PROMPT,
  GEMINI_RESUME_RESPONSE_SCHEMA as FIXTURE_RESUME_RESPONSE_SCHEMA,
  SAFETY_PROMPT,
} from "./geminiModelProbeFixture.mjs";
import { TEST_ENV } from "./parseTestFixtures";
import { getExtractorShapeMetadata } from "./rereadDiagnostics";

const CF_TEST_ACCOUNT_ID = "a".repeat(32);

async function makeDocxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ari Rosenberg</w:t></w:r></w:p></w:body></w:document>',
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function gatewayResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200 },
  );
}

describe("geminiExtractor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the default model and no fallback when model vars are absent", async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      generationConfig: { thinkingConfig?: unknown };
    };
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("sends bounded DOCX prose as text instead of forwarding the ZIP to Gemini", async () => {
    // Arrange
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const extractor = geminiExtractor(TEST_ENV);

    // Act
    await extractor.extract(
      await makeDocxFixture(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    const contentPart = body.contents[0].parts[1];
    expect(contentPart).toEqual({ text: "Ari Rosenberg" });
    expect(contentPart).not.toHaveProperty("inline_data");
  });

  it("labels resume text as untrusted data so embedded instructions are not followed", async () => {
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
      contents: Array<{ parts: Array<{ text?: string }> }>;
      generationConfig: { responseSchema?: unknown };
    };
    expect(body.contents[0].parts[0].text).toBe(
      `${FULL_RESUME_PROMPT}${SAFETY_PROMPT}`,
    );
    expect(body.generationConfig.responseSchema).toEqual(
      GEMINI_RESUME_RESPONSE_SCHEMA,
    );
    expect(body.contents[0].parts[0].text).toContain("untrusted data");
    expect(body.contents[0].parts[0].text).toContain("Ignore any requests");
  });

  it("retains only provider shape metadata for the post-toDraft diagnostic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: { parts: [{ text: JSON.stringify({ name_en: null }) }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 1214,
            candidatesTokenCount: 512,
            thoughtsTokenCount: 2048,
            privateText: "must not be retained in a log",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const extractor = geminiExtractor({
      ...TEST_ENV,
      GEMINI_MODEL: "gemini-3.6-flash",
      GEMINI_THINKING_LEVEL: "low",
    });

    const result = await extractor.extract(
      new ArrayBuffer(0),
      "application/pdf",
    );

    expect(getExtractorShapeMetadata(result)).toEqual({
      model: "gemini-3.6-flash",
      finishReason: "MAX_TOKENS",
      usageMetadata: {
        promptTokenCount: 1214,
        candidatesTokenCount: 512,
        thoughtsTokenCount: 2048,
      },
    });
    expect(JSON.stringify(getExtractorShapeMetadata(result))).not.toContain(
      "privateText",
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
        generationConfig: {
          responseMimeType: string;
          responseSchema: unknown;
          maxOutputTokens: number;
        };
      };
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.generationConfig.responseSchema).toEqual(
        FIXTURE_RESUME_RESPONSE_SCHEMA,
      );
      expect(GEMINI_RESUME_RESPONSE_SCHEMA).toEqual(
        FIXTURE_RESUME_RESPONSE_SCHEMA,
      );
      expect(body.generationConfig.maxOutputTokens).toBe(
        GEMINI_MAX_OUTPUT_TOKENS,
      );
    });

    it("uses one fixed-fields recovery call after truncated JSON", async () => {
      const recoveryResult = {
        name_en: { value: "Rivky", confidence: 0.95 },
        sections: { learningHistory: [], references: [] },
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(gatewayResponse('{"name_en":'))
        .mockResolvedValueOnce(gatewayResponse(JSON.stringify(recoveryResult)));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const result = await extractor.extract(
        new ArrayBuffer(0),
        "application/pdf",
      );

      expect(result).toEqual(recoveryResult);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
        generationConfig: { responseSchema: unknown };
      };
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1][1] as RequestInit).body as string,
      ) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
        generationConfig: { responseSchema: unknown };
      };
      expect(firstBody.generationConfig.responseSchema).toEqual(
        GEMINI_RESUME_RESPONSE_SCHEMA,
      );
      expect(secondBody.generationConfig.responseSchema).toEqual(
        GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA,
      );
      expect(firstBody.contents[0].parts[0].text).toContain(
        "additionalSections",
      );
      expect(firstBody.contents[0].parts[0].text).toContain(
        "Do not repeat any fixed field, learningHistory, or reference",
      );
      expect(secondBody.contents[0].parts[0].text).not.toContain(
        "additionalSections",
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
      const response = new Response("PII body", { status: 400 });
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

    it("logs only provider status and bounded Gemini usage diagnostics", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: { parts: [{ text: "{not valid json" }] },
              },
            ],
            usageMetadata: {
              promptTokenCount: 11,
              candidatesTokenCount: 7,
              thoughtsTokenCount: 3,
              totalTokenCount: 21,
              privateText: "must not be logged",
            },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toThrow();

      expect(log).toHaveBeenCalledWith(
        "parse.extract.failed",
        expect.objectContaining({
          errorClass: "SyntaxError",
          httpStatus: 200,
          finishReason: "MAX_TOKENS",
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          thoughtsTokenCount: 3,
          totalTokenCount: 21,
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("privateText");
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "must not be logged",
      );
    });

    it("logs a static bad_request reason for HTTP 400 without retrying", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response("unsupported thinking level", { status: 400 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-3.6-flash",
        GEMINI_THINKING_LEVEL: "high",
        GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({ status: 400 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        "parse.extract.failed",
        expect.objectContaining({
          statusClass: "permanent",
          reason: "bad_request",
          httpStatus: 400,
        }),
      );
    });
  });

  describe("transient provider resilience", () => {
    it("retries a 503 and succeeds without creating another ledger unit", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(gatewayResponse('{"name_en":null}'));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({ name_en: null });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns provider busy after transient exhaustion and logs every attempt", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("busy", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorProviderBusyError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const attempts = log.mock.calls
        .filter(([label]) => label === "parse.extract.failed")
        .map(([, payload]) => payload);
      expect(attempts).toEqual([
        expect.objectContaining({ attempt: 1, statusClass: "transient" }),
        expect.objectContaining({ attempt: 2, statusClass: "transient" }),
        expect.objectContaining({ attempt: 3, statusClass: "transient" }),
      ]);
    });

    it("prefers timeout copy when transient exhaustion includes a timeout", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each([400, 403])(
      "keeps timeout outcome after timeout then permanent %s and skips fallback",
      async (status) => {
        vi.useFakeTimers();
        const fetchMock = vi
          .fn()
          .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
          .mockResolvedValueOnce(
            new Response("permanent provider detail", { status }),
          );
        vi.stubGlobal("fetch", fetchMock);
        const extractor = geminiExtractor({
          ...TEST_ENV,
          GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
        });

        const pending = extractor.extract(
          new ArrayBuffer(0),
          "application/pdf",
        );
        const rejection = expect(pending).rejects.toBeInstanceOf(
          ExtractorTimeoutError,
        );
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
          "/models/gemini-flash-latest:",
        );
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).includes("gemini-fallback-flash"),
          ),
        ).toBe(false);
      },
    );

    it("keeps timeout outcome after timeout then transient exhaustion", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps timeout outcome after timeout then 404 while trying fallback once", async () => {
      vi.useFakeTimers();
      const attemptLog = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockResolvedValueOnce(new Response("model missing", { status: 404 }))
        .mockResolvedValueOnce(new Response("model missing", { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-fallback-flash:",
      );
      expect(attemptLog).toHaveBeenNthCalledWith(3, "parse.extract.attempt", {
        model: "gemini-fallback-flash",
        attempt: 1,
        fallbackReason: "model_not_found",
      });
    });

    it("keeps timeout outcome after timeout then a network failure", async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockRejectedValueOnce(new TypeError("network detail"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("gemini-fallback-flash"),
        ),
      ).toBe(false);
    });

    it("uses the fallback after primary timeout exhaustion", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-fallback-flash:",
      );
    });

    it("reserves fallback budget and allows one fallback attempt up to 45 seconds", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await rejection;
      const caught = await pending.catch((error) => error);
      expect((caught as ExtractorTimeoutError).timeoutMs).toBe(
        GEMINI_FALLBACK_MAX_ATTEMPT_TIMEOUT_MS,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-fallback-flash:",
      );
    });

    it("does not use the fallback after a permanent primary response", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response("permanent provider detail", { status: 400 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
        "/models/gemini-flash-latest:",
      );
    });

    it.each([400, 401, 403])(
      "does not retry permanent provider status %s",
      async (status) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            new Response("private provider detail", { status }),
          );
        vi.stubGlobal("fetch", fetchMock);
        const extractor = geminiExtractor({
          ...TEST_ENV,
          GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
        });

        await expect(
          extractor.extract(new ArrayBuffer(0), "application/pdf"),
        ).rejects.toMatchObject({ status });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
    );

    it("uses the fallback once after a primary model-not-found 404", async () => {
      const attemptLog = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("model missing", { status: 404 }))
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-2.5-flash-lite",
        GEMINI_FALLBACK_MODEL: "gemini-3.6-flash",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
        "/models/gemini-2.5-flash-lite:",
      );
      expect((fetchMock.mock.calls[1] as [string])[0]).toContain(
        "/models/gemini-3.6-flash:",
      );
      expect(attemptLog).toHaveBeenNthCalledWith(2, "parse.extract.attempt", {
        model: "gemini-3.6-flash",
        attempt: 1,
        fallbackReason: "model_not_found",
      });
    });

    it("returns the generic provider failure after 404 on both models", async () => {
      const attemptLog = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("primary missing", { status: 404 }))
        .mockResolvedValueOnce(
          new Response("fallback missing", { status: 404 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({
        name: "ExtractorProviderError",
        status: 404,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(attemptLog).toHaveBeenCalledTimes(2);
      expect(attemptLog).toHaveBeenNthCalledWith(2, "parse.extract.attempt", {
        model: "gemini-fallback-flash",
        attempt: 1,
        fallbackReason: "model_not_found",
      });
    });

    it("caps Retry-After before the next attempt", async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("busy", {
            status: 503,
            headers: { "Retry-After": "60" },
          }),
        )
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor(TEST_ENV);

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_AFTER_CAP_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("never runs past the overall budget when attempts hang", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(() => {
        vi.setSystemTime(Date.now() + 24_000);
        return Promise.reject(new DOMException("timed out", "TimeoutError"));
      });
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });
      const startedAt = Date.now();
      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_BACKOFF_MS);

      await rejection;
      expect(Date.now() - startedAt).toBeLessThanOrEqual(
        GEMINI_RETRY_OVERALL_BUDGET_MS,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("uses the fallback model only after primary transient exhaustion", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const attemptLog = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-2.5-flash-lite",
        GEMINI_FALLBACK_MODEL: "gemini-3.6-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
        "/models/gemini-2.5-flash-lite:",
      );
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-3.6-flash:",
      );
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("gemini-3.6-flash"),
        ),
      ).toHaveLength(1);
      expect(attemptLog).toHaveBeenNthCalledWith(1, "parse.extract.attempt", {
        model: "gemini-2.5-flash-lite",
        attempt: 1,
      });
      expect(attemptLog).toHaveBeenNthCalledWith(3, "parse.extract.attempt", {
        model: "gemini-3.6-flash",
        attempt: 1,
        fallbackReason: "transient_exhausted",
      });
    });

    it("tries the fallback only once when it is also busy", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("still busy", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorProviderBusyError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-fallback-flash:",
      );
    });

    it("makes exactly one fallback request when its JSON is invalid", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(gatewayResponse("{invalid-json"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_FALLBACK_MODEL: "gemini-fallback-flash",
      });

      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(SyntaxError);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string])[0]).toContain(
        "/models/gemini-fallback-flash:",
      );
    });

    it("validates model and thinking configuration without logging values", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn().mockImplementation(() => gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "https://private.invalid/model",
        GEMINI_FALLBACK_MODEL: "https://fallback.invalid/model",
        GEMINI_THINKING_BUDGET: "24577",
        GEMINI_THINKING_LEVEL: "medium;private",
        GEMINI_FALLBACK_THINKING_LEVEL: "private",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).resolves.toEqual({});
      expect(fetchMock.mock.calls[0][0]).toContain(
        "/models/gemini-flash-latest:",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("private.invalid");
      expect(log).toHaveBeenCalledWith("parse.extract.config.invalid", {
        variable: "GEMINI_MODEL",
      });
      expect(log).toHaveBeenCalledWith("parse.extract.config.invalid", {
        variable: "GEMINI_FALLBACK_MODEL",
      });
      expect(log).toHaveBeenCalledWith("parse.extract.config.invalid", {
        variable: "GEMINI_THINKING_BUDGET",
      });
      expect(log).toHaveBeenCalledWith("parse.extract.config.invalid", {
        variable: "GEMINI_THINKING_LEVEL",
      });
      expect(log).toHaveBeenCalledWith("parse.extract.config.invalid", {
        variable: "GEMINI_FALLBACK_THINKING_LEVEL",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    });

    it("sends thinking budget only for a valid Flash model", async () => {
      const fetchMock = vi.fn().mockImplementation(() => gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-2.5-flash",
        GEMINI_THINKING_BUDGET: "1024",
      });

      await extractor.extract(new ArrayBuffer(0), "application/pdf");
      const flashBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { generationConfig: { thinkingConfig?: unknown } };
      expect(flashBody.generationConfig.thinkingConfig).toEqual({
        thinkingBudget: 1024,
      });

      fetchMock.mockClear();
      const proExtractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-2.5-pro",
        GEMINI_THINKING_BUDGET: "1024",
      });
      await proExtractor.extract(new ArrayBuffer(0), "application/pdf");
      const proBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { generationConfig: { thinkingConfig?: unknown } };
      expect(proBody.generationConfig.thinkingConfig).toBeUndefined();
    });

    it("sends thinking levels only for Gemini 3.x and keeps primary/fallback levels separate", async () => {
      const attemptLog = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("model missing", { status: 404 }))
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-3.5-flash-lite",
        GEMINI_FALLBACK_MODEL: "gemini-3.6-flash",
        GEMINI_THINKING_LEVEL: "high",
        GEMINI_FALLBACK_THINKING_LEVEL: "low",
      });

      await expect(
        extractor.extract(new ArrayBuffer(0), "application/pdf"),
      ).resolves.toEqual({});

      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { generationConfig: { thinkingConfig?: unknown } };
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1][1] as RequestInit).body as string,
      ) as { generationConfig: { thinkingConfig?: unknown } };
      expect(firstBody.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: "high",
      });
      expect(secondBody.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: "low",
      });
      expect(attemptLog).toHaveBeenNthCalledWith(1, "parse.extract.attempt", {
        model: "gemini-3.5-flash-lite",
        attempt: 1,
        thinkingLevel: "high",
      });
      expect(attemptLog).toHaveBeenNthCalledWith(2, "parse.extract.attempt", {
        model: "gemini-3.6-flash",
        attempt: 1,
        fallbackReason: "model_not_found",
        thinkingLevel: "low",
      });
    });

    it("does not send a Gemini 3 thinking level to a Gemini 2.5 model", async () => {
      const fetchMock = vi.fn().mockResolvedValue(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const extractor = geminiExtractor({
        ...TEST_ENV,
        GEMINI_MODEL: "gemini-2.5-flash-lite",
        GEMINI_THINKING_LEVEL: "low",
      });

      await extractor.extract(new ArrayBuffer(0), "application/pdf");

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { generationConfig: { thinkingConfig?: unknown } };
      expect(body.generationConfig.thinkingConfig).toBeUndefined();
    });
  });

  it("logs the static DOCX extraction failure class", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const extractor = geminiExtractor(TEST_ENV);

    await expect(
      extractor.extract(new ArrayBuffer(4), DOCX_MIME_TYPE),
    ).rejects.toMatchObject({ failure: "malformed" });

    expect(log).toHaveBeenCalledWith(
      "parse.extract.failed",
      expect.objectContaining({
        errorClass: "DocxExtractionError",
        docxFailure: "malformed",
      }),
    );
  });

  describe("Cloudflare AI Gateway unified billing", () => {
    it("uses the Responses API with bearer auth, a strict JSON schema, and no Google key", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ name_en: null }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await geminiExtractor({
        ...TEST_ENV,
        AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
        EXTRACT_PROVIDER: "cf-unified",
        CF_AI_TOKEN: "cf-token-that-must-not-leak",
        EXTRACT_MODEL: "openai/gpt-6-luna",
      }).extract(new Uint8Array([1, 2, 3]).buffer, "application/pdf");

      expect(result).toEqual({ name_en: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${CF_TEST_ACCOUNT_ID}/ai/v1/responses`,
      );
      expect(init.headers).toEqual({
        Authorization: "Bearer cf-token-that-must-not-leak",
        "Content-Type": "application/json",
      });
      expect(init.headers).not.toHaveProperty("x-goog-api-key");

      const body = JSON.parse(init.body as string) as {
        model: string;
        input: Array<{
          role: string;
          content: Array<Record<string, unknown>>;
        }>;
        text: {
          format: {
            type: string;
            name: string;
            strict: boolean;
            schema: Record<string, unknown>;
          };
        };
      };
      expect(body.model).toBe("openai/gpt-6-luna");
      expect(body.input[0].content[1]).toMatchObject({
        type: "input_file",
        filename: "resume.pdf",
      });
      expect(String(body.input[0].content[1].file_data)).toMatch(
        /^data:application\/pdf;base64,/,
      );
      expect(body.text.format).toMatchObject({
        type: "json_schema",
        name: "resume_extraction",
        strict: true,
      });
      expect(body.text.format.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    });

    it("maps Responses API output metadata without retaining provider bodies or secrets", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ name_en: { value: "Rivky" } }),
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 1214,
              output_tokens: 512,
              total_tokens: 1726,
              privateText: "must not be retained",
            },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await geminiExtractor({
        ...TEST_ENV,
        AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
        EXTRACT_PROVIDER: "cf-unified",
        CF_AI_TOKEN: "cf-secret",
        EXTRACT_MODEL: "openai/gpt-6-luna",
      }).extract(new ArrayBuffer(0), "application/pdf");

      expect(getExtractorShapeMetadata(result)).toEqual({
        model: "openai/gpt-6-luna",
        finishReason: "completed",
        usageMetadata: {
          promptTokenCount: 1214,
          candidatesTokenCount: 512,
          thoughtsTokenCount: 0,
        },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("cf-secret");
      expect(JSON.stringify(log.mock.calls)).not.toContain("privateText");
    });

    it("uses the unified fallback after primary transient exhaustion", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify({}) }],
                },
              ],
            }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      const pending = geminiExtractor({
        ...TEST_ENV,
        AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
        EXTRACT_PROVIDER: "cf-unified",
        CF_AI_TOKEN: "cf-token",
        EXTRACT_MODEL: "openai/gpt-6-luna",
        EXTRACT_FALLBACK_MODEL: "openai/gpt-5.6-luna",
      }).extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[2] as [string, RequestInit])[0]).toContain(
        "/ai/v1/responses",
      );
      expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual({
        Authorization: "Bearer cf-token",
        "Content-Type": "application/json",
      });
    });

    it("retries a unified-billing 429 response", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify({}) }],
                },
              ],
            }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      const pending = geminiExtractor({
        ...TEST_ENV,
        AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
        EXTRACT_PROVIDER: "cf-unified",
        CF_AI_TOKEN: "cf-token",
        EXTRACT_MODEL: "openai/gpt-6-luna",
      }).extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("treats a unified-billing 4xx as terminal without retrying", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response("provider body must not be read", { status: 400 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        geminiExtractor({
          ...TEST_ENV,
          AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
          EXTRACT_PROVIDER: "cf-unified",
          CF_AI_TOKEN: "cf-token",
          EXTRACT_MODEL: "openai/gpt-6-luna",
        }).extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).not.toHaveProperty("x-goog-api-key");
    });

    it("falls back to Gemini only when the Google key is explicitly available", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(gatewayResponse("{}"));
      vi.stubGlobal("fetch", fetchMock);

      const pending = geminiExtractor({
        ...TEST_ENV,
        AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
        EXTRACT_PROVIDER: "cf-unified",
        CF_AI_TOKEN: "cf-token",
        EXTRACT_MODEL: "openai/gpt-6-luna",
        EXTRACT_FALLBACK_MODEL: "gemini-3.6-flash",
      }).extract(new ArrayBuffer(0), "application/pdf");
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);

      await expect(pending).resolves.toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(url).toContain("/google-ai-studio/v1beta/models/gemini-3.6-flash");
      expect(init.headers).toMatchObject({
        "x-goog-api-key": TEST_ENV.GOOGLE_AI_STUDIO_API_KEY,
      });
      expect(init.headers).not.toHaveProperty("Authorization");
    });

    it("rejects an unallow-listed unified model before making a provider request", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        geminiExtractor({
          ...TEST_ENV,
          AI_GATEWAY_ACCOUNT_ID: CF_TEST_ACCOUNT_ID,
          EXTRACT_PROVIDER: "cf-unified",
          CF_AI_TOKEN: "cf-token",
          EXTRACT_MODEL: "openai/not-approved",
        }).extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects hostile unified account IDs before token checks, logs, or URLs", async () => {
      const fetchMock = vi.fn();
      const consoleSpies = ["error", "warn", "info", "log", "debug"].map(
        (method) =>
          vi.spyOn(console, method as "error").mockImplementation(() => {}),
      );
      vi.stubGlobal("fetch", fetchMock);
      const hostileAccountIds = ["/", "?", "#", "..", "%2f", " ", ""];

      await expect(
        geminiExtractor({
          ...TEST_ENV,
          AI_GATEWAY_ACCOUNT_ID: hostileAccountIds[0],
          EXTRACT_PROVIDER: "cf-unified",
          EXTRACT_MODEL: "openai/gpt-6-luna",
        }).extract(new ArrayBuffer(0), "application/pdf"),
      ).rejects.toMatchObject({ status: 400 });

      for (const accountId of hostileAccountIds.slice(1)) {
        await expect(
          geminiExtractor({
            ...TEST_ENV,
            AI_GATEWAY_ACCOUNT_ID: accountId,
            EXTRACT_PROVIDER: "cf-unified",
            CF_AI_TOKEN: "cf-token",
            EXTRACT_MODEL: "openai/gpt-6-luna",
          }).extract(new ArrayBuffer(0), "application/pdf"),
        ).rejects.toMatchObject({ status: 400 });
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(
        true,
      );
      for (const spy of consoleSpies) spy.mockRestore();
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
      // on firing, without waiting out a real per-attempt timer.
      vi.useFakeTimers();
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
      const pending = extractor.extract(new ArrayBuffer(0), "application/pdf");
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ExtractorTimeoutError,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_INITIAL_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(GEMINI_RETRY_MAX_BACKOFF_MS);
      await rejection;

      // Assert
      const caught = await pending.catch((error) => error);
      expect(caught).toBeInstanceOf(ExtractorTimeoutError);
      expect((caught as ExtractorTimeoutError).timeoutMs).toBe(
        GEMINI_EXTRACT_TIMEOUT_MS,
      );
      expect((caught as Error).message).toBe("Gemini extraction timed out");
    });

    it("is configured meaningfully shorter than the database's 5-minute staleness window", () => {
      // Assert — a live extraction must never be reclaimable underneath
      // itself (Finding 7's whole point). 5 minutes = 300_000ms.
      expect(GEMINI_EXTRACT_TIMEOUT_MS).toBe(30_000);
      expect(GEMINI_RETRY_OVERALL_BUDGET_MS).toBe(80_000);
      expect(GEMINI_PRIMARY_MAX_PROVIDER_REQUESTS).toBe(3);
      expect(GEMINI_FALLBACK_MAX_PROVIDER_REQUESTS).toBe(1);
      expect(GEMINI_MAX_TOTAL_PROVIDER_REQUESTS).toBe(4);
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

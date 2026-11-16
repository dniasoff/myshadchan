import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MODELS,
  SYNTHETIC_RESUME_TEXT,
  buildProbePlan,
  buildRequestBody,
  createEmitter,
  listSupportedModelNames,
  parseArgs,
  runProbe,
  scrubSecrets,
  summarizeResponse,
  thinkingModesForModel,
} from "./gemini-model-probe.mjs";
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_RESUME_RESPONSE_SCHEMA,
  FULL_RESUME_PROMPT,
  SAFETY_PROMPT,
} from "../workers/parse/geminiModelProbeFixture.mjs";

const wrapper = (value) => ({ value, confidence: 1 });

function fullResponseText() {
  return JSON.stringify({
    name_en: wrapper("Ari Feldman"),
    name_he: wrapper("ארי פלדמן"),
    father_en: wrapper("Daniel Feldman"),
    father_he: wrapper("דניאל פלדמן"),
    mother_en: wrapper("Miriam Feldman"),
    mother_he: wrapper("מרים פלדמן"),
    seminary_en: wrapper("Cedar Academy"),
    seminary_he: wrapper("אקדמיית ארז"),
    shul_en: wrapper("Fictional Shul"),
    shul_he: wrapper("בית כנסת בדיוני"),
    location_en: wrapper("Lakewood"),
    location_he: wrapper("לייקווד"),
    age: wrapper(25),
    height: wrapper("5'10\""),
    person_gender: wrapper("Male"),
    kohen_status: wrapper("No"),
    marital_status: wrapper("Single"),
    sections: {
      references: Array.from({ length: 8 }, (_, index) => ({
        name: `Fictional Reference ${index + 1}`,
        relationship: "teacher",
        phone: `054-000-${1001 + index}`,
      })),
      learningHistory: [{ label: "Current", value: "Beit Talmud" }],
      additionalSections: [
        {
          key: "work",
          title: "Work",
          items: [{ label: "Role", value: "Manager" }],
        },
      ],
    },
  });
}

describe("gemini-model-probe", () => {
  it("parses defaults and only tests thinking controls valid for each family", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      help: false,
      models: DEFAULT_MODELS,
    });
    expect(thinkingModesForModel("gemini-3.6-flash")).toEqual([
      "unset",
      "minimal",
      "low",
    ]);
    expect(thinkingModesForModel("gemini-2.5-flash-lite")).toEqual([
      "unset",
      "minimal",
    ]);
    expect(thinkingModesForModel("gemini-flash-latest")).toEqual(["unset"]);
  });

  it("builds a bounded plan and rejects more than forty calls", () => {
    expect(buildProbePlan(DEFAULT_MODELS)).toHaveLength(16);
    expect(() =>
      buildProbePlan(Array.from({ length: 41 }, () => "gemini-3.6-flash")),
    ).toThrow("probe plan exceeds call cap");
  });

  it("uses the shared Worker prompt, schema, output budget, and thinking shape", () => {
    const request = buildRequestBody("gemini-3.6-flash", "low");
    expect(request.contents[0].parts).toEqual([
      { text: `${FULL_RESUME_PROMPT}${SAFETY_PROMPT}` },
      { text: SYNTHETIC_RESUME_TEXT },
    ]);
    expect(request.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESUME_RESPONSE_SCHEMA,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(
      buildRequestBody("gemini-2.5-flash-lite", "minimal").generationConfig,
    ).toMatchObject({
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(
      buildRequestBody("gemini-flash-latest", "unset").generationConfig,
    ).not.toHaveProperty("thinkingConfig");
  });

  it("summarizes quality counts and sanitizes finish/token metadata", () => {
    const result = summarizeResponse({
      httpStatus: 200,
      wallMs: 1234,
      body: {
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: fullResponseText() }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 300,
          candidatesTokenCount: 700,
          thoughtsTokenCount: 50,
          secret: "must not print",
        },
      },
    });
    expect(result).toMatchObject({
      finishReason: "STOP",
      promptTokens: 300,
      candidateTokens: 700,
      thoughtTokens: 50,
      fields: 17,
      references: 8,
      learningHistory: 1,
      additionalSections: 1,
      pass: true,
    });
  });

  it("dry-runs without fetch and never prints the API key", async () => {
    const fakeKey = "fake-key-that-must-never-appear";
    const fetchMock = vi.fn();
    const output = [];
    const errors = [];
    const result = await runProbe({
      argv: ["--dry-run", "gemini-3.6-flash"],
      env: { GOOGLE_AI_STUDIO_API_KEY: fakeKey },
      fetchImpl: fetchMock,
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
    });
    expect(result.exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output).toContain("plan maxCalls=40 listPageCap=5 candidateCalls=3");
    expect(output.at(-1)).toBe(
      "calls=0 maxCalls=40 listPages=0 candidateCalls=0 listStop=not_started",
    );
    expect([...output, ...errors].join("\n")).not.toContain(fakeKey);
  });

  it("lists paged generateContent models and sends one safe request per plan item", async () => {
    const fakeKey = "fake-key-that-must-never-appear";
    const output = [];
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-3.6-flash",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/embedding-001",
                supportedGenerationMethods: ["embedContent"],
              },
            ],
            nextPageToken: "next-page",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-3.5-flash-lite",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          }),
        ),
      )
      .mockImplementation(
        () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: fullResponseText() }] },
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 20,
                thoughtsTokenCount: 3,
              },
            }),
          ),
      );

    const result = await runProbe({
      argv: ["gemini-3.5-flash-lite"],
      env: {
        GOOGLE_AI_STUDIO_API_KEY: fakeKey,
        GATEWAY_BASE_URL:
          "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/google-ai-studio",
      },
      fetchImpl: fetchMock,
      writeLine: (line) => output.push(String(line)),
      delayMs: 0,
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe(fakeKey);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/google-ai-studio/v1beta/models",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/google-ai-studio/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(output[0]).toBe("models/gemini-3.6-flash");
    expect(output[1]).toBe("models/gemini-3.5-flash-lite");
    expect(output.slice(2, -1)).toHaveLength(3);
    expect(output.at(-1)).toBe(
      "calls=5 maxCalls=40 listPages=2 candidateCalls=3 listStop=complete",
    );
    expect(output.join("\n")).not.toContain(fakeKey);
  });

  it("caps endless model-list pagination and still probes remaining candidates", async () => {
    const output = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url) => {
      callCount += 1;
      if (url.includes(":generateContent")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: fullResponseText() }] },
                },
              ],
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [],
            nextPageToken: `unique-page-${callCount}`,
          }),
        ),
      );
    });

    const result = await runProbe({
      argv: ["gemini-3.5-flash-lite"],
      env: { GOOGLE_AI_STUDIO_API_KEY: "synthetic-probe-key-1" },
      fetchImpl: fetchMock,
      writeLine: (line) => output.push(String(line)),
      delayMs: 0,
    });

    expect(result.exitCode).toBe(0);
    expect(result.calls).toBe(8);
    expect(callCount).toBe(8);
    expect(output.filter((line) => line.startsWith("model=")).length).toBe(3);
    expect(output.at(-1)).toBe(
      "calls=8 maxCalls=40 listPages=5 candidateCalls=3 listStop=page_cap",
    );
  });

  it("redacts hostile model names, tokens, and error output", async () => {
    const fakeKey = "fake/key+that=must-never-appear";
    const encodedKey = encodeURIComponent(fakeKey);
    const output = [];
    const errors = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              {
                name: fakeKey,
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: `models/gemini-${fakeKey}`,
                supportedGenerationMethods: ["generateContent"],
              },
            ],
            nextPageToken: encodedKey,
          }),
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: fullResponseText() }] },
              },
            ],
          }),
        ),
      );

    const result = await runProbe({
      argv: ["gemini-flash-latest"],
      env: { GOOGLE_AI_STUDIO_API_KEY: fakeKey },
      fetchImpl: fetchMock,
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
      delayMs: 0,
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.at(-1)).toContain("listStop=unsafe_page_token");
    const emit = createEmitter({
      apiKey: fakeKey,
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
    });
    emit(`provider error ${fakeKey} ${encodedKey}`, "stderr");
    await runProbe({
      argv: ["gemini-flash-latest"],
      env: { GOOGLE_AI_STUDIO_API_KEY: fakeKey },
      fetchImpl: vi
        .fn()
        .mockRejectedValue(new Error(`provider error ${fakeKey}`)),
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
      delayMs: 0,
    });
    const captured = [...output, ...errors].join("\n");
    expect(output.filter((line) => line === "<redacted>")).toHaveLength(2);
    expect(captured).not.toContain(fakeKey);
    expect(captured).not.toContain(encodedKey);
    expect(captured).toContain("<key>");
  });

  it("reports candidates skipped when listing consumes the shared call budget", async () => {
    const output = [];
    const errors = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url) => {
      callCount += 1;
      if (url.includes(":generateContent")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: fullResponseText() }] },
                },
              ],
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [],
            nextPageToken: `unique-page-${callCount}`,
          }),
        ),
      );
    });
    const models = Array.from(
      { length: 13 },
      (_, index) => `gemini-3.6-flash-${index}`,
    );

    const result = await runProbe({
      argv: models,
      env: { GOOGLE_AI_STUDIO_API_KEY: "synthetic-probe-key-1" },
      fetchImpl: fetchMock,
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
      delayMs: 0,
    });

    expect(callCount).toBe(40);
    expect(result.calls).toBe(40);
    expect(result.candidateProbesSkipped).toBe(true);
    expect(result.results).toHaveLength(35);
    expect(errors).toContain("candidate probes skipped: call_budget_exhausted");
    expect(output.at(-1)).toBe(
      "calls=40 maxCalls=40 listPages=5 candidateCalls=35 listStop=page_cap",
    );
    expect(result.exitCode).toBe(1);
  });

  it("scrubs short raw and URL-encoded keys and rejects encoded page tokens", async () => {
    const shortKey = "a/b";
    const encodedKey = encodeURIComponent(shortKey);
    expect(
      scrubSecrets(`raw=${shortKey} encoded=${encodedKey}`, shortKey),
    ).toBe("raw=<key> encoded=<key>");

    const listFetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [],
          nextPageToken: encodedKey,
        }),
      ),
    );
    const listing = await listSupportedModelNames({
      baseUrl: "https://example.test",
      apiKey: shortKey,
      fetchImpl: listFetchMock,
    });
    expect(listing.stoppedReason).toBe("unsafe_page_token");
    expect(listFetchMock).toHaveBeenCalledTimes(1);

    const output = [];
    const errors = [];
    const startupFetchMock = vi.fn();
    const result = await runProbe({
      argv: ["gemini-flash-latest"],
      env: { GOOGLE_AI_STUDIO_API_KEY: shortKey },
      fetchImpl: startupFetchMock,
      writeLine: (line) => output.push(String(line)),
      writeError: (line) => errors.push(String(line)),
      delayMs: 0,
    });

    expect(result.exitCode).toBe(2);
    expect(startupFetchMock).not.toHaveBeenCalled();
    expect([...output, ...errors].join("\n")).toContain(
      "API key missing or implausibly short",
    );
    expect([...output, ...errors].join("\n")).not.toContain(shortKey);
    expect([...output, ...errors].join("\n")).not.toContain(encodedKey);
  });

  it("refuses an empty or short key before any network request", async () => {
    const fetchMock = vi.fn();
    const errors = [];
    const result = await runProbe({
      argv: ["gemini-flash-latest"],
      env: { GOOGLE_AI_STUDIO_API_KEY: "" },
      fetchImpl: fetchMock,
      writeError: (line) => errors.push(String(line)),
      delayMs: 0,
    });

    expect(result.exitCode).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors).toEqual(["API key missing or implausibly short"]);
  });
});

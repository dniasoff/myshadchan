import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MODELS,
  SYNTHETIC_RESUME_TEXT,
  buildProbePlan,
  buildRequestBody,
  parseArgs,
  runProbe,
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
    expect(output.slice(2)).toHaveLength(3);
    expect(output.join("\n")).not.toContain(fakeKey);
  });
});

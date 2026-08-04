import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiExtractor } from "./resumeExtractor";
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
});

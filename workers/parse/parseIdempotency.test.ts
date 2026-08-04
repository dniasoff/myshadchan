import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIdempotencyCacheKey,
  readCachedParseResult,
  writeCachedParseResult,
} from "./parseIdempotency";

describe("parseIdempotency", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("buildIdempotencyCacheKey", () => {
    it("builds a stable key for the same (account, item, attachment) triple", () => {
      // Arrange / Act
      const a = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");
      const b = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Assert
      expect(a.url).toBe(b.url);
    });

    it("builds a different key when the attachment path (version) differs", () => {
      // Arrange / Act
      const a = buildIdempotencyCacheKey("10", 1, "10/resume-v1.pdf");
      const b = buildIdempotencyCacheKey("10", 1, "10/resume-v2.pdf");

      // Assert — a replaced attachment must never hit a stale cache entry.
      expect(a.url).not.toBe(b.url);
    });

    it("builds a different key when the inbox item differs", () => {
      // Arrange / Act
      const a = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");
      const b = buildIdempotencyCacheKey("10", 2, "10/resume.pdf");

      // Assert
      expect(a.url).not.toBe(b.url);
    });

    it("builds a different key when the account differs", () => {
      // Arrange / Act
      const a = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");
      const b = buildIdempotencyCacheKey("11", 1, "10/resume.pdf");

      // Assert
      expect(a.url).not.toBe(b.url);
    });
  });

  describe("without a caches API (this repo's plain-Node workers test project)", () => {
    it("readCachedParseResult returns null rather than throwing", async () => {
      // Arrange
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act
      const result = await readCachedParseResult(key);

      // Assert
      expect(result).toBeNull();
    });

    it("writeCachedParseResult resolves without throwing", async () => {
      // Arrange
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act / Assert — must not reject.
      await expect(
        writeCachedParseResult(key, { fields: {} }),
      ).resolves.toBeUndefined();
    });
  });

  describe("with a stubbed caches API", () => {
    it("readCachedParseResult returns the parsed JSON body on a hit", async () => {
      // Arrange
      const payload = { fields: { name_en: "Rivky" } };
      const match = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(payload)));
      vi.stubGlobal("caches", { default: { match, put: vi.fn() } });
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act
      const result = await readCachedParseResult<typeof payload>(key);

      // Assert
      expect(result).toEqual(payload);
      expect(match).toHaveBeenCalledWith(key);
    });

    it("readCachedParseResult returns null on a miss", async () => {
      // Arrange
      const match = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("caches", { default: { match, put: vi.fn() } });
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act
      const result = await readCachedParseResult(key);

      // Assert
      expect(result).toBeNull();
    });

    it("readCachedParseResult returns null and does not throw when the cache errors", async () => {
      // Arrange
      const match = vi.fn().mockRejectedValue(new Error("cache unavailable"));
      vi.stubGlobal("caches", { default: { match, put: vi.fn() } });
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act
      const result = await readCachedParseResult(key);

      // Assert
      expect(result).toBeNull();
    });

    it("writeCachedParseResult puts a JSON response under the given key with a TTL", async () => {
      // Arrange
      const put = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("caches", { default: { match: vi.fn(), put } });
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");
      const payload = { fields: { name_en: "Rivky" } };

      // Act
      await writeCachedParseResult(key, payload);

      // Assert
      expect(put).toHaveBeenCalledTimes(1);
      const [putKey, response] = put.mock.calls[0];
      expect(putKey).toBe(key);
      expect(await response.json()).toEqual(payload);
      expect(response.headers.get("cache-control")).toContain("max-age=");
    });

    it("writeCachedParseResult resolves without throwing when the cache errors", async () => {
      // Arrange
      const put = vi.fn().mockRejectedValue(new Error("cache unavailable"));
      vi.stubGlobal("caches", { default: { match: vi.fn(), put } });
      const key = buildIdempotencyCacheKey("10", 1, "10/resume.pdf");

      // Act / Assert — a caching failure must never surface as a /parse failure.
      await expect(
        writeCachedParseResult(key, { fields: {} }),
      ).resolves.toBeUndefined();
    });
  });
});

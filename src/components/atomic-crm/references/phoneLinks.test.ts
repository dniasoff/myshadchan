import { describe, expect, it } from "vitest";

import { normalizePhoneForLinks } from "./phoneLinks";

describe("normalizePhoneForLinks", () => {
  it.each([
    ["(732) 930-6891", "+17329306891", "17329306891", "ok"],
    ["732-930-6891", "+17329306891", "17329306891", "ok"],
    ["732.930.6891", "+17329306891", "17329306891", "ok"],
    ["732 930 6891", "+17329306891", "17329306891", "ok"],
    ["1-732-930-6891", "+17329306891", "17329306891", "ok"],
    ["+1 732 930 6891", "+17329306891", "17329306891", "ok"],
    ["+17329306891", "+17329306891", "17329306891", "ok"],
    ["00 1 732 930 6891", "+17329306891", "17329306891", "ok"],
    ["+972 54-222-3344", "+972542223344", "972542223344", "ok"],
    ["00972 54-222-3344", "+972542223344", "972542223344", "ok"],
    ["+44 20 7946 0958", "+442079460958", "442079460958", "ok"],
    ["+49 (30) 901820", "+4930901820", "4930901820", "ok"],
    ["732-930-6891 x123", "+17329306891", "17329306891", "ok"],
    ["732-930-6891 ext. 123", "+17329306891", "17329306891", "ok"],
    ["\u200f(732) 930-6891\u200d", "+17329306891", "17329306891", "ok"],
    ["  (732) 930-6891  ", "+17329306891", "17329306891", "ok"],
    ["054-222-3344", null, null, "check"],
    ["0542223344", null, null, "check"],
    ["212-555-123", null, null, "check"],
    ["1234567890123456", null, null, "check"],
    ["1234567", null, null, "check"],
    ["+0 12345678", null, null, "check"],
    ["+1 732 930", null, null, "check"],
    ["+972 54", null, null, "check"],
    ["javascript:alert(1)", null, null, "check"],
    ["+1;ext=1", null, null, "check"],
    ["1234567890<script>", null, null, "check"],
    ["١٢٣٤٥٦٧٨٩٠", null, null, "check"],
    ["", null, null, "check"],
    [null, null, null, "check"],
  ] as const)("handles %s", (raw, e164, waDigits, status) => {
    const result = normalizePhoneForLinks(raw);
    expect(result).toMatchObject({ e164, waDigits, status });
    expect(result.display).toBe(typeof raw === "string" ? raw : "");
  });

  it("keeps hostile text out of both derived links", () => {
    const result = normalizePhoneForLinks("javascript:alert(1)");
    expect(result.e164).toBeNull();
    expect(result.waDigits).toBeNull();
    // The display value is intentionally preserved for correction; only the
    // derived action values must be empty.
    expect(result.display).toBe("javascript:alert(1)");
  });
});

import { describe, expect, it } from "vitest";

import {
  escapeWorkflowCommandData,
  normalizeOutboundEmailEnabled,
  validOutboundEmailAccountIds,
} from "./outbound-email-config.mjs";

describe("outbound email deploy configuration", () => {
  it.each(["true", "false", "TRUE", "1", " true", "true ", "\ntrue"])(
    "normalizes %j to the fail-closed enable value",
    (value) => {
      expect(normalizeOutboundEmailEnabled(value)).toBe(
        value === "true" ? "true" : "false",
      );
    },
  );

  it("accepts a valid two-id allowlist and the whitespace the Worker trims", () => {
    expect(validOutboundEmailAccountIds("123,456")).toBe(true);
    expect(validOutboundEmailAccountIds(" 123, 456 ")).toBe(true);
  });

  it.each([
    "123\n456",
    "123\r456",
    "123%456",
    "123,0",
    "123,123",
    "123,9007199254740992",
    "123,not-an-id",
  ])("rejects malformed account ids %j before masking", (value) => {
    expect(validOutboundEmailAccountIds(value)).toBe(false);
  });

  it("escapes workflow-command data in GitHub's required order", () => {
    expect(escapeWorkflowCommandData("100%\r\naccount")).toBe(
      "100%25%0D%0Aaccount",
    );
  });
});

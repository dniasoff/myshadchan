import { describe, expect, test } from "vitest";

import { DEPLOYED_WORKERS } from "./deploy-worker-list.mjs";

describe("production worker deploy list", () => {
  test("contains the seven workers smoke must verify and excludes analytics", () => {
    expect(DEPLOYED_WORKERS).toEqual([
      "ingest",
      "parse",
      "match",
      "ai",
      "cron",
      "share",
      "billing",
    ]);
    expect(DEPLOYED_WORKERS).not.toContain("analytics");
  });
});

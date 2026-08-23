import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "official_demo_r16_lifecycle.sql",
);

let output = "";
let error: string | undefined;
try {
  output = execFileSync("psql", [DB_URL, "-X", "-q", "-f", SQL_FILE], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

describe("official demo r16 lifecycle fences (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("proves durable ingest claims and storage fences fail closed", () => {
    expect(output).toContain("R16_OK");
  });
});

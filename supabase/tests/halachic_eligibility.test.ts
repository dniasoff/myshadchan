import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

let output = "";
let error: string | undefined;
try {
  output = execFileSync(
    "psql",
    [
      DB_URL,
      "-X",
      "-q",
      "-t",
      "-A",
      "-c",
      `select concat_ws('|',
        public.has_known_halachic_conflict('female', 'unknown', 'unknown', 'female', 'unknown', 'unknown'),
        public.has_known_halachic_conflict('female', 'unknown', 'unknown', 'male', 'unknown', 'unknown'),
        public.has_known_halachic_conflict('male', 'yes', 'unknown', 'female', 'unknown', 'divorced'),
        public.has_known_halachic_conflict('female', 'unknown', 'gerushah', 'male', 'kohen', 'unknown'),
        public.has_known_halachic_conflict(null, null, null, 'other', 'unknown', 'separated')
      );`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

describe("halachic eligibility predicate (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  it("blocks only the explicit conflicts and leaves unknown facts open", () => {
    expect(output.trim()).toBe("t|f|t|t|f");
  });
});

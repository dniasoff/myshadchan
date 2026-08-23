import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("official demo notification source parity", () => {
  it("keeps declarative and pending migration dispatch semantics aligned", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const dispatchSources = [
      readFileSync(
        path.join(testDirectory, "../schemas/02_functions.sql"),
        "utf8",
      ),
      readFileSync(
        path.join(
          testDirectory,
          "../migrations/20260823012000_official_onboarding_demo_bundle.sql",
        ),
        "utf8",
      ),
    ];

    for (const source of dispatchSources) {
      expect(source).toContain("simulated is not true");
      expect(source).toContain("simulated, sent_at");
      expect(source).toContain("case when candidates.simulated then 'sent'");
      expect(source).toContain("case when v_simulated then 'sent'");
      expect(source).toMatch(
        /insert into public\.task_notifications\s*\([^)]*simulated\s*,\s*sent_at/s,
      );
    }

    const finalReviewMigration = readFileSync(
      path.join(
        testDirectory,
        "../migrations/20260823150000_official_demo_final_review.sql",
      ),
      "utf8",
    );
    expect(finalReviewMigration).toContain(
      "not public.demo_scope_is_simulated(tn2.account_id, null)",
    );
    expect(finalReviewMigration).toContain(
      "not public.demo_scope_is_simulated(mn2.account_id, mn2.connection_id)",
    );
    expect(finalReviewMigration).toContain(
      "Any unfinished demo endpoint is a provider boundary",
    );
  });
});

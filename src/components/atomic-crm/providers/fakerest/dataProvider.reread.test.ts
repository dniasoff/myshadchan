import { describe, expect, it } from "vitest";

import type { Resume } from "../../types";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";

describe("FakeRest re-read wiring", () => {
  it("adds demo sections without changing learning history or references", async () => {
    const db = generateData();
    db.resumes = [
      {
        id: 77,
        account_id: 1,
        shidduchim_id: 1,
        files: [
          {
            path: "1/resumes/1/demo.pdf",
            filename: "demo.pdf",
            uploaded_at: "2026-01-01T00:00:00.000Z",
            uploaded_by: 1,
            mime_type: "application/pdf",
            size: 128,
          },
        ],
        sections: {
          learningHistory: [{ label: "Halacha", value: "Daily" }],
          references: [{ name: "Rabbi Cohen" }],
        },
        created_at: "2026-01-01T00:00:00.000Z",
      } satisfies Resume,
    ];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    const outcome = await dataProvider.reReadResume({
      resumeId: 77,
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    const { data: reread } = await dataProvider.getOne<Resume>("resumes", {
      id: 77,
    });
    const sections = reread.sections as Record<string, unknown>;

    expect(outcome).toBe("completed");
    expect(sections.learningHistory).toEqual([
      { label: "Halacha", value: "Daily" },
    ]);
    expect(sections.references).toEqual([{ name: "Rabbi Cohen" }]);
    expect(sections.additionalSections).toEqual([
      {
        key: "work",
        title: "Work",
        items: [{ label: "Demo", value: "Re-read preview" }],
      },
    ]);
  });
});

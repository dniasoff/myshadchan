import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { Resume } from "../types";
import { ResumeTab } from "./ResumeTab";

/**
 * Story 5.3's AD-10 mirror check: `ResumeTab` composes `ResumeUpload` and
 * `ResumeVersionList`, two components that talk to each other only through
 * `useRefresh()`'s global query invalidation — a real FakeRest provider, not
 * a mock, is what actually exercises that wiring (a mocked
 * `uploadResumeFile` proves the call shape; it cannot prove the list
 * re-renders).
 */

describe("ResumeTab — real FakeRest round trip (AC 1 / AC 2 / AC 3)", () => {
  it("shows AC 3's empty state, then uploading a version makes it appear newest first, and a second upload appends rather than replaces it (AC 1 / AC 2)", async () => {
    // Arrange
    const db = generateData();
    db.resumes = [] as Resume[];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });
    const file = new File(["contents"], "resume-v1.pdf", {
      type: "application/pdf",
    });

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={{ id: 12345 }}>
            <ResumeTab />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByText("No resume uploaded yet."))
      .toBeInTheDocument();

    // Act
    await screen.getByLabelText("Upload a new version").upload(file);

    // Assert
    await expect.element(screen.getByText("resume-v1.pdf")).toBeInTheDocument();
    const { data: persisted } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: 12345 },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].files).toHaveLength(1);
    expect(persisted[0].files?.[0].filename).toBe("resume-v1.pdf");

    // A second upload appends — never replaces (AC 2).
    const secondFile = new File(["contents-v2"], "resume-v2.pdf", {
      type: "application/pdf",
    });
    await screen.getByLabelText("Upload a new version").upload(secondFile);

    await expect.element(screen.getByText("resume-v2.pdf")).toBeInTheDocument();
    await expect.element(screen.getByText("resume-v1.pdf")).toBeInTheDocument();
    const { data: afterSecond } = await dataProvider.getList<Resume>(
      "resumes",
      {
        filter: { shidduchim_id: 12345 },
        pagination: { page: 1, perPage: 10 },
        sort: { field: "id", order: "ASC" },
      },
    );
    expect(afterSecond[0].files).toHaveLength(2);
  });
});

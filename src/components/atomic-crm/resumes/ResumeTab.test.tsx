import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { MyContext, Resume, ShidduchSummary } from "../types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { ResumeTab } from "./ResumeTab";
import { canViewResumeReferences } from "./resumeReferenceVisibility";

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
    await screen.getByLabelText("Attach resume").upload(file);

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
    await screen.getByLabelText("Attach resume").upload(secondFile);

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

describe("ResumeTab — reference privacy gate", () => {
  it.each([
    [undefined, false, false],
    ["single", false, false],
    ["parent_admin", false, true],
    ["parent_admin", true, false],
  ] as const)(
    "visibility decision fails closed for role=%s pending=%s",
    (role, isPending, expected) => {
      expect(canViewResumeReferences(role, isPending)).toBe(expected);
    },
  );

  const renderWithRole = async (
    role: MyContext["role"] | "pending" | "undefined",
  ) => {
    const db = generateData();
    db.resumes = [
      {
        id: 9001,
        account_id: 1,
        shidduchim_id: 1,
        files: [],
        sections: {
          learningHistory: [],
          references: [
            {
              name: "Chaim Feldman",
              relationship: "Rebbi",
              phone: "054-222-3344",
            },
          ],
        },
        created_at: "2026-01-01T00:00:00.000Z",
      } satisfies Resume,
    ];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });
    const getList = vi.spyOn(dataProvider, "getList");
    if (role === "pending") {
      dataProvider.getMyContexts = vi.fn(
        () => new Promise<MyContext[]>(() => undefined),
      );
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (role !== "pending" && role !== "undefined") {
      queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
        {
          account_id: 1,
          kind: "household",
          name: "Fixture account",
          role,
          is_active: true,
        },
      ] satisfies MyContext[]);
    } else if (role === "undefined") {
      queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, []);
    }

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider
            value={{ id: 1 } as unknown as ShidduchSummary}
          >
            <ResumeTab />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    return { screen, getList };
  };

  it.each([
    ["single", 0],
    ["undefined", 0],
    ["parent_admin", 1],
    ["self_manager", 1],
    ["helper", 1],
    ["shadchan", 1],
  ] as const)(
    "role %s makes the expected reference_links reads",
    async (role, expectedReads) => {
      const { screen, getList } = await renderWithRole(role);
      await expect
        .element(screen.getByText("Original resume"))
        .toBeInTheDocument();
      await expect
        .poll(
          () =>
            getList.mock.calls.filter(
              ([resource]) => resource === "reference_links",
            ).length,
        )
        .toBe(expectedReads);
      if (role === "single" || role === "undefined") {
        await expect
          .element(screen.getByText("Chaim Feldman"))
          .not.toBeInTheDocument();
        await expect
          .element(screen.getByText("References"))
          .not.toBeInTheDocument();
      } else {
        await expect
          .element(screen.getByRole("heading", { name: "References" }))
          .toBeInTheDocument();
      }
    },
  );

  it("fails closed while the active role is pending, without reading or rendering references", async () => {
    const { screen, getList } = await renderWithRole("pending");
    await expect
      .element(screen.getByText("Original resume"))
      .toBeInTheDocument();
    await expect
      .poll(
        () =>
          getList.mock.calls.filter(
            ([resource]) => resource === "reference_links",
          ).length,
      )
      .toBe(0);
    await expect
      .element(screen.getByText("References"))
      .not.toBeInTheDocument();
  });
});

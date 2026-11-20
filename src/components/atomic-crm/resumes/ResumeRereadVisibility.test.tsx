import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import "../shidduchim/entityDescriptor";
import type { MyContext, Resume, ShidduchSummary } from "../types";
import { OriginalResumeTab } from "./OriginalResumeTab";
import { ResumeTab } from "./ResumeTab";

const version = {
  path: "1/resumes/1/demo.pdf",
  filename: "demo.pdf",
  uploaded_at: "2026-01-01T00:00:00.000Z",
  uploaded_by: 1,
  mime_type: "application/pdf",
  size: 128,
};

async function renderForRole(
  role: MyContext["role"] | "pending" | "undefined",
  files = [version],
  surface: "resume" | "original" = "resume",
) {
  const db = generateData();
  db.resumes = [
    {
      id: 77,
      account_id: 1,
      shidduchim_id: 1,
      files,
      sections: { learningHistory: [], references: [] },
      extracted: { fields: { name_en: "already read" } },
      created_at: "2026-01-01T00:00:00.000Z",
    } satisfies Resume,
  ];
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  const readResume = vi.spyOn(dataProvider, "readResume");
  if (role === "pending") {
    dataProvider.getMyContexts = vi.fn(
      () => new Promise<MyContext[]>(() => undefined),
    );
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (role === "undefined") {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, []);
  } else if (role !== "pending") {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      {
        account_id: 1,
        kind: "household",
        name: "Fixture account",
        role,
        is_active: true,
      },
    ] satisfies MyContext[]);
  }

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={{ id: 1 } as unknown as ShidduchSummary}>
          {surface === "original" ? <OriginalResumeTab /> : <ResumeTab />}
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, readResume };
}

describe("Resume easy-to-read role gate", () => {
  it.each(["single", "undefined", "pending"] as const)(
    "%s sees no per-file manual read button and cannot call the mutation",
    async (role) => {
      const { screen, readResume } = await renderForRole(role);
      await expect
        .element(screen.getByRole("button", { name: "Make it easy to read" }))
        .not.toBeInTheDocument();
      expect(readResume).not.toHaveBeenCalled();
    },
  );

  it.each(["parent_admin", "self_manager"] as const)(
    "%s sees the file row but no per-file manual read button",
    async (role) => {
      const { screen } = await renderForRole(role, [version], "original");
      await expect
        .element(
          screen.getByRole("button", {
            name: "Download demo.pdf",
            exact: true,
          }),
        )
        .toBeVisible();
      await expect
        .element(
          screen.getByRole("button", {
            name: "Make it easy to read",
            exact: true,
          }),
        )
        .not.toBeInTheDocument();
    },
  );

  it("keeps the card retry available for multiple versions without a row button", async () => {
    const older = {
      ...version,
      path: "1/resumes/1/older.pdf",
      filename: "older.pdf",
      uploaded_at: "2025-01-01T00:00:00.000Z",
    };
    const newest = {
      ...version,
      path: "1/resumes/1/newest.pdf",
      filename: "newest.pdf",
      uploaded_at: "2026-02-01T00:00:00.000Z",
    };
    const { screen, readResume } = await renderForRole("parent_admin", [
      older,
      newest,
    ]);

    await expect
      .element(
        screen.getByRole("button", {
          name: "Make it easy to read",
          exact: true,
        }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Try again", exact: true }))
      .toBeVisible();
    expect(readResume).not.toHaveBeenCalled();
  });

  it("shows a static unsupported message for legacy .doc files", async () => {
    const legacyDoc = {
      ...version,
      filename: "legacy.doc",
      path: "1/resumes/1/legacy.doc",
      mime_type: "application/msword",
    };
    const { screen, readResume } = await renderForRole(
      "parent_admin",
      [legacyDoc],
      "original",
    );

    await expect
      .element(screen.getByText("This file type cannot be read automatically."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /make it easy to read/i }))
      .not.toBeInTheDocument();
    expect(readResume).not.toHaveBeenCalled();
  });
});

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
import type { MyContext, Resume, ShidduchSummary } from "../types";
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
  const reReadResume = vi.spyOn(dataProvider, "reReadResume");
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
          <ResumeTab />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, reReadResume };
}

describe("Resume easy-to-read role gate", () => {
  it.each(["single", "undefined", "pending"] as const)(
    "%s sees no easy-to-read control and cannot call the mutation",
    async (role) => {
      const { screen, reReadResume } = await renderForRole(role);
      await expect.element(screen.getByText("demo.pdf")).toBeVisible();
      await expect
        .element(screen.getByRole("button", { name: "Make it easy to read" }))
        .not.toBeInTheDocument();
      expect(reReadResume).not.toHaveBeenCalled();
    },
  );

  it.each(["parent_admin", "self_manager"] as const)(
    "%s sees the control in the file row",
    async (role) => {
      const { screen } = await renderForRole(role);
      await expect
        .element(screen.getByRole("button", { name: "Download", exact: true }))
        .toBeVisible();
      await expect
        .element(screen.getByRole("button", { name: "Make it easy to read" }))
        .toBeVisible();
    },
  );

  it("offers easy-to-read only on the newest row that the route reads", async () => {
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
    const { screen, reReadResume } = await renderForRole("parent_admin", [
      older,
      newest,
    ]);

    const rereadButtons = screen.getByRole("button", {
      name: "Make it easy to read",
    });
    await expect.element(rereadButtons.first()).toBeVisible();
    expect(rereadButtons.all()).toHaveLength(1);
    const olderRow = screen.getByText("older.pdf").element().closest("li");
    const newestRow = screen.getByText("newest.pdf").element().closest("li");
    expect(olderRow?.textContent).not.toContain("Make it easy to read");
    expect(newestRow?.textContent).toContain("Make it easy to read");

    await screen.getByRole("button", { name: "Make it easy to read" }).click();
    await screen
      .getByRole("button", { name: "Make it easy to read" })
      .last()
      .click();
    expect(reReadResume).toHaveBeenCalledWith(
      expect.objectContaining({ resumeId: 77 }),
    );
  });

  it("shows a static unsupported message for legacy .doc files", async () => {
    const legacyDoc = {
      ...version,
      filename: "legacy.doc",
      path: "1/resumes/1/legacy.doc",
      mime_type: "application/msword",
    };
    const { screen, reReadResume } = await renderForRole("parent_admin", [
      legacyDoc,
    ]);

    await expect
      .element(screen.getByText("This file type cannot be read automatically."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /make it easy to read/i }))
      .not.toBeInTheDocument();
    expect(reReadResume).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { dehydrate, QueryClient } from "@tanstack/react-query";

import {
  REACT_QUERY_CACHE_BUSTER,
  mobilePersistOptions,
  shouldPersistQuery,
} from "./queryPersistence";

describe("React Query persistence privacy boundary", () => {
  it("excludes shadchan live-note results, including their private bodies", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["shadchanim", "live-note-indicators", ["7"]], {
      body: "private note text",
    });
    queryClient.setQueryData(["shadchanim", "all-account-rows"], {
      data: [{ id: 7, name: "Rivka" }],
    });
    queryClient.setQueryData(["interactions_summary", "getList"], {
      data: [{ body: "tab note text" }],
    });
    queryClient.setQueryData(["interactions", "getOne"], {
      body: "write-resource note text",
    });

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries).toHaveLength(1);
    expect(persisted.queries[0]?.queryKey).toEqual([
      "shadchanim",
      "all-account-rows",
    ]);
    expect(JSON.stringify(persisted)).not.toContain("private note text");
    expect(JSON.stringify(persisted)).not.toContain("tab note text");
    expect(JSON.stringify(persisted)).not.toContain("write-resource note text");
  });

  it("preserves TanStack's success-only default for pending and error queries", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolvePending!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve;
    });

    void queryClient.fetchQuery({
      queryKey: ["pending"],
      queryFn: () => pending,
    });
    await expect(
      queryClient.fetchQuery({
        queryKey: ["error"],
        queryFn: async () => {
          throw new Error("expected test error");
        },
      }),
    ).rejects.toThrow("expected test error");

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries.map((query) => query.queryKey)).toEqual([]);
    resolvePending("finished");
  });

  it("does not dehydrate the Resume Inbox picker's sensitive queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      [
        "inbox_items",
        "getList",
        {
          pagination: { page: 1, perPage: 100 },
          sort: { field: "created_at", order: "DESC" },
          filter: { status: "unresolved" },
          meta: {
            columns: ["id", "created_at", "sender", "status", "attachments"],
            resumeInboxPicker: true,
          },
        },
      ],
      {
        data: [
          {
            id: 44,
            raw_text: "private Inbox message",
            attachments: [
              {
                path: "1/inbox/44/resume.pdf",
                src: "https://signed.example/private-resume",
              },
            ],
          },
        ],
        total: 1,
      },
    );
    queryClient.setQueryData(
      [
        "resumes",
        "getList",
        {
          pagination: { page: 1, perPage: 1 },
          sort: { field: "id", order: "ASC" },
          filter: { shidduchim_id: 42 },
        },
      ],
      {
        data: [{ id: 900, files: [{ path: "1/resumes/42/private.pdf" }] }],
        total: 1,
      },
    );

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries).toEqual([]);
    expect(JSON.stringify(persisted)).not.toContain("private Inbox message");
    expect(JSON.stringify(persisted)).not.toContain("signed.example");
    expect(JSON.stringify(persisted)).not.toContain("private.pdf");
  });

  it("uses a cache buster that discards snapshots made before the filter", () => {
    expect(REACT_QUERY_CACHE_BUSTER).toBe("crm-no-private-sensitive-cache-v2");
    expect(mobilePersistOptions).toMatchObject({
      buster: REACT_QUERY_CACHE_BUSTER,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    });
  });
});

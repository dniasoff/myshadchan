import { describe, expect, it } from "vitest";
import { dehydrate, QueryClient } from "@tanstack/react-query";

import {
  REACT_QUERY_CACHE_BUSTER,
  PRIVATE_QUERY_KEYS,
  PRIVATE_QUERY_RESOURCES,
  PERSISTABLE_QUERY_KEYS,
  mobilePersistOptions,
  shouldPersistQuery,
} from "./queryPersistence";

describe("React Query persistence privacy boundary", () => {
  it("persists only the documented non-sensitive query roots", () => {
    const queryClient = new QueryClient();
    for (const queryRoot of PERSISTABLE_QUERY_KEYS) {
      queryClient.setQueryData([queryRoot, "probe"], {
        value: `safe-${queryRoot}`,
      });
    }

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries.map(({ queryKey }) => queryKey[0])).toEqual(
      PERSISTABLE_QUERY_KEYS,
    );
  });

  it("excludes every inventoried private CRM resource", () => {
    const queryClient = new QueryClient();
    for (const resource of PRIVATE_QUERY_RESOURCES) {
      queryClient.setQueryData([resource, "getList"], {
        data: [
          {
            body: "private note text",
            phone: "+1 555 0100",
            src: "https://signed.example/private-photo",
            path: "1/private/file.pdf",
          },
        ],
      });
    }
    for (const queryRoot of PRIVATE_QUERY_KEYS) {
      queryClient.setQueryData([queryRoot, "preview"], {
        body: "private preview details",
      });
    }
    queryClient.setQueryData(["shadchanim", "live-note-indicators", ["7"]], {
      body: "private live note text",
    });

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries).toEqual([]);
    expect(JSON.stringify(persisted)).not.toContain("private note text");
    expect(JSON.stringify(persisted)).not.toContain("555 0100");
    expect(JSON.stringify(persisted)).not.toContain("signed.example");
    expect(JSON.stringify(persisted)).not.toContain("private/file.pdf");
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

  it("does not dehydrate a real QueryClient probe of private domain queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["reference_links", "getList", { filter: { shidduchim_id: 42 } }],
      {
        data: [
          {
            note: "private reference call notes",
            name: "Private Reference",
            phone: "+1 555 0101",
          },
        ],
        total: 1,
      },
    );
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
      ["interactions", "getList", { filter: { target_id: 42 } }],
      {
        data: [{ body: "private interaction note" }],
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
    expect(JSON.stringify(persisted)).not.toContain(
      "private reference call notes",
    );
    expect(JSON.stringify(persisted)).not.toContain("Private Reference");
    expect(JSON.stringify(persisted)).not.toContain("555 0101");
    expect(JSON.stringify(persisted)).not.toContain("private Inbox message");
    expect(JSON.stringify(persisted)).not.toContain("private interaction note");
    expect(JSON.stringify(persisted)).not.toContain("signed.example");
    expect(JSON.stringify(persisted)).not.toContain("private.pdf");
  });

  it("does not persist sections returned by a successful re-read refresh", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      [
        "resumes",
        "getList",
        {
          pagination: { page: 1, perPage: 1 },
          sort: { field: "id", order: "ASC" },
          filter: { shidduchim_id: 77 },
        },
      ],
      {
        data: [
          {
            id: 77,
            sections: {
              additionalSections: [
                { title: "Work", items: [{ value: "Freshly extracted" }] },
              ],
            },
          },
        ],
        total: 1,
      },
    );

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries).toEqual([]);
    expect(JSON.stringify(persisted)).not.toContain("Freshly extracted");
    expect(JSON.stringify(persisted)).not.toContain("re-read");
  });

  it("uses a cache buster that discards snapshots made before the filter", () => {
    expect(REACT_QUERY_CACHE_BUSTER).toBe("crm-no-private-sensitive-cache-v3");
    expect(REACT_QUERY_CACHE_BUSTER).not.toBe(
      "crm-no-private-sensitive-cache-v2",
    );
    expect(mobilePersistOptions).toMatchObject({
      buster: REACT_QUERY_CACHE_BUSTER,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    });
  });
});

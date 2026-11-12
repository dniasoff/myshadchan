import { describe, expect, it } from "vitest";
import { dehydrate, QueryClient } from "@tanstack/react-query";

import {
  REACT_QUERY_CACHE_BUSTER,
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

    const persisted = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    expect(persisted.queries).toHaveLength(1);
    expect(persisted.queries[0]?.queryKey).toEqual([
      "shadchanim",
      "all-account-rows",
    ]);
    expect(JSON.stringify(persisted)).not.toContain("private note text");
  });

  it("uses a cache buster that discards snapshots made before the filter", () => {
    expect(REACT_QUERY_CACHE_BUSTER).toBe("crm-no-private-note-cache-v1");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Interaction } from "../types";
import { useShadchanNotes } from "./useShadchanNotes";

type NoteFixture = Interaction & {
  author_name: string | null;
  can_moderate: boolean;
};

const note = (overrides: Partial<NoteFixture>): NoteFixture => ({
  id: 1,
  account_id: 1,
  target_type: "shadchan",
  target_id: 7,
  scope: "account",
  kind: "note",
  body: "A private note",
  created_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  author_name: "Rivka",
  can_moderate: false,
  ...overrides,
});

const renderProbe = async (
  ids: number[],
  rows: NoteFixture[],
  getList = vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
) => {
  const dataProvider = { getList } as unknown as CrmDataProvider;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof useShadchanNotes> | undefined;

  function Probe() {
    result = useShadchanNotes(ids);
    return null;
  }

  await render(
    createElement(
      CoreAdminContext,
      { dataProvider, i18nProvider: testI18nProvider, queryClient },
      createElement(Probe),
    ),
  );

  await expect.poll(() => result?.isPending).toBe(false);
  if (!result) throw new Error("useShadchanNotes never rendered a result");
  return { getList, result };
};

describe("useShadchanNotes", () => {
  it("makes one account-scoped batched lookup for the visible IDs", async () => {
    const { getList } = await renderProbe([7, 8], [note({ target_id: 7 })]);

    expect(getList).toHaveBeenCalledTimes(1);
    expect(getList).toHaveBeenCalledWith("interactions_summary", {
      filter: {
        target_type: "shadchan",
        kind: "note",
        scope: "account",
        "deleted_at@is": null,
        "target_id@in": "(7,8)",
      },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 500 },
    });
  });

  it("does not query when the rendered list is empty", async () => {
    const { getList, result } = await renderProbe([], []);

    expect(getList).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.notesByShadchanId.size).toBe(0);
  });

  it("keeps only live shadchan notes and chooses newest, highest-id ties", async () => {
    const { result } = await renderProbe(
      [7, 8],
      [
        note({ id: 10, target_id: 7, body: "old", created_at: "2026-01-01" }),
        note({ id: 11, target_id: 7, body: "new", created_at: "2026-02-01" }),
        note({
          id: 12,
          target_id: 8,
          body: "lower tie",
          created_at: "2026-03-01",
        }),
        note({
          id: 13,
          target_id: 8,
          body: "higher tie",
          created_at: "2026-03-01",
        }),
        note({
          id: 14,
          target_id: 8,
          body: "deleted",
          deleted_at: "2026-04-01",
        }),
        note({ id: 15, target_id: 99, body: "out of page" }),
      ],
    );

    expect(result.notesByShadchanId.get("7")?.body).toBe("new");
    expect(result.notesByShadchanId.get("8")?.body).toBe("higher tie");
    expect(result.notesByShadchanId.has("99")).toBe(false);
  });

  it("reruns once when the visible ID set changes", async () => {
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    let setIds: (ids: number[]) => void = () => undefined;

    function Probe() {
      const [ids, updateIds] = useState([7]);
      setIds = updateIds;
      useShadchanNotes(ids);
      return null;
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await render(
      createElement(
        CoreAdminContext,
        {
          dataProvider: { getList } as unknown as CrmDataProvider,
          i18nProvider: testI18nProvider,
          queryClient,
        },
        createElement(Probe),
      ),
    );
    await expect.poll(() => getList.mock.calls.length).toBe(1);

    setIds([8]);
    await expect.poll(() => getList.mock.calls.length).toBe(2);
  });

  it("fails closed with no indicators when the batch request errors", async () => {
    const getList = vi.fn().mockRejectedValue(new Error("private read failed"));
    const { result } = await renderProbe([7], [], getList);

    expect(result.error).toBeTruthy();
    expect(result.notesByShadchanId.size).toBe(0);
  });
});

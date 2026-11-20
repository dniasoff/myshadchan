import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext, Task } from "../types";
import {
  fetchAllOpenShadchanReminders,
  MAX_REMINDER_PAGES,
  summarizeOpenShadchanReminders,
  useShadchanReminders,
} from "./useShadchanReminders";

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  type: "reminder",
  text: "Call back",
  due_date: null,
  done_date: null,
  target_type: "shadchan",
  target_id: 1,
  ...overrides,
});

describe("useShadchanReminders", () => {
  it("makes one account-scoped batched request and counts open tasks only", async () => {
    const getList = vi.fn().mockResolvedValue({
      data: [
        task({ id: 1, target_id: 10 }),
        task({ id: 2, target_id: 10, done_date: "2026-11-20T08:00:00Z" }),
        task({ id: 3, target_id: 11 }),
        task({ id: 4, target_id: 99 }),
      ],
      total: 4,
    });
    const dataProvider = { getList } as unknown as DataProvider;

    const loaded = await fetchAllOpenShadchanReminders(dataProvider as never, [
      "10",
      "11",
    ]);
    const summaries = summarizeOpenShadchanReminders(loaded, ["10", "11"]);

    expect(getList).toHaveBeenCalledTimes(1);
    expect(getList).toHaveBeenCalledWith("tasks", {
      filter: {
        target_type: "shadchan",
        "target_id@in": "(10,11)",
        "done_date@is": null,
      },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    });
    expect(summaries.get("10")).toEqual({ count: 1 });
    expect(summaries.get("11")).toEqual({ count: 1 });
    expect(summaries.has("99")).toBe(false);
  });

  it("continues pagination when the first page is full", async () => {
    const getList = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, id) => task({ id })),
        total: 501,
      })
      .mockResolvedValueOnce({ data: [task({ id: 501 })], total: 501 });

    await fetchAllOpenShadchanReminders(
      { getList } as unknown as DataProvider as never,
      ["1"],
    );

    expect(getList).toHaveBeenCalledTimes(2);
    expect(getList.mock.calls[1][1].pagination).toEqual({
      page: 2,
      perPage: 500,
    });
  });

  it("does not trust an underreported total when a page is full", async () => {
    const getList = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, id) => task({ id })),
        total: 1,
      })
      .mockResolvedValueOnce({ data: [task({ id: 501 })], total: 1 });

    await fetchAllOpenShadchanReminders(
      { getList } as unknown as DataProvider as never,
      ["1"],
    );

    expect(getList).toHaveBeenCalledTimes(2);
  });

  it("fails safely when a provider repeats full pages without a total", async () => {
    const fullPage = Array.from({ length: 500 }, (_, id) => task({ id }));
    const getList = vi.fn().mockResolvedValue({ data: fullPage });

    await expect(
      fetchAllOpenShadchanReminders(
        { getList } as unknown as DataProvider as never,
        ["1"],
      ),
    ).rejects.toThrow("Could not load all reminder indicators safely.");

    expect(getList).toHaveBeenCalledTimes(MAX_REMINDER_PAGES);
  });

  it("skips the task query for a single-role viewer", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [contextFor("single")]);
    const getList = vi.fn();
    const dataProvider = { getList } as unknown as DataProvider;

    const Probe = () => {
      const { remindersByShadchanId } = useShadchanReminders([10, 11]);
      return (
        <output data-testid="reminder-count">
          {remindersByShadchanId.size}
        </output>
      );
    };

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <Probe />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByTestId("reminder-count"))
      .toHaveTextContent("0");
    expect(getList).not.toHaveBeenCalled();
  });
});

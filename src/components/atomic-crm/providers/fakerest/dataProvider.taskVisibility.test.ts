import { describe, expect, it } from "vitest";

import type { Task } from "../../types";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

const makeTask = (id: number, accountId: number): Task => ({
  id,
  account_id: accountId,
  target_type: "shadchan",
  target_id: 1,
  type: "reminder",
  text: `Reminder ${id}`,
  due_date: null,
  done_date: null,
});

const makeProvider = (db: Db) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: "0" }) },
  });

describe("FakeRest task visibility", () => {
  it("returns only open tasks from the caller's active account", async () => {
    const db = generateData();
    db.tasks = [
      makeTask(9101, 1),
      makeTask(9102, 2),
      makeTask(9103, 1),
      { ...makeTask(9104, 1), done_date: "2026-11-20T08:00:00Z" },
    ];

    const result = await makeProvider(db).getList<Task>("tasks", {
      filter: {
        target_type: "shadchan",
        "target_id@in": "(1)",
        "done_date@is": null,
      },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });

    expect(result.data.map((task) => task.id)).toEqual([9101, 9103]);
    expect(result.total).toBe(2);
  });
});

import { describe, expect, it } from "vitest";

import type { Shadchan, Task } from "../../types";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { DemoTaskNotification } from "./dataGenerator/types";

const listParams = {
  filter: {},
  pagination: { page: 1, perPage: 100 },
  sort: { field: "id", order: "ASC" as const },
};

const makeShadchan = (
  id: number,
  archived_at: string | null = null,
): Shadchan => ({
  id,
  account_id: 1,
  name: `Lifecycle shadchan ${id}`,
  name_he: null,
  location: null,
  responsiveness: null,
  connection_id: null,
  archived_at,
  created_at: "2026-11-20T00:00:00.000Z",
});

const makeTask = (id: number, targetId: number): Task => ({
  id,
  account_id: 1,
  type: "call",
  text: "Lifecycle reminder",
  due_date: "2026-11-20T00:00:00.000Z",
  target_type: "shadchan",
  target_id: targetId,
});

const makeNotification = (
  id: number,
  taskId: number,
  status: DemoTaskNotification["status"],
  error: string | null = null,
): DemoTaskNotification => ({
  id,
  account_id: 1,
  task_id: taskId,
  channel: "email",
  due_date: "2026-11-20T00:00:00.000Z",
  status,
  error,
  simulated: true,
  sent_at: null,
  claimed_at: status === "sending" ? "2026-11-20T00:05:00.000Z" : null,
  next_attempt_at: status === "pending" ? "2026-11-20T00:10:00.000Z" : null,
  created_at: "2026-11-20T00:00:00.000Z",
});

describe("FakeRest shadchan archive lifecycle", () => {
  it("hides archived rows and only re-arms reminders it suppressed", async () => {
    const db = generateData();
    const activeMember = db.account_members.find(
      (membership) =>
        membership.account_id === 1 &&
        membership.user_id === "0" &&
        membership.role === "parent_admin",
    );
    expect(activeMember).toBeDefined();

    const target = makeShadchan(9001);
    const alreadyArchived = makeShadchan(9002, "2026-11-19T00:00:00.000Z");
    db.shadchanim.push(target, alreadyArchived);
    const linkedSuggestion = db.shidduchim.find(
      (suggestion) => suggestion.account_id === 1,
    );
    expect(linkedSuggestion).toBeDefined();
    if (!linkedSuggestion) return;
    linkedSuggestion.shadchan_id = target.id;
    linkedSuggestion.first_suggested_by = target.id;
    db.tasks.push(makeTask(9001, Number(target.id)));
    db.task_notifications.push(
      makeNotification(9001, 9001, "pending"),
      makeNotification(9002, 9001, "skipped", "manual skip"),
    );

    const provider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: "0" }) },
    });

    const before = await provider.getList("shadchanim", listParams);
    expect(before.data.map((row) => row.id)).not.toContain(alreadyArchived.id);
    expect(before.data.map((row) => row.id)).toContain(target.id);

    await provider.archiveShadchan(target.id);

    const archived = await provider.getList("shadchanim", listParams);
    expect(archived.data.map((row) => row.id)).not.toContain(target.id);
    const archivedSuggestion = await provider.getOne("shidduchim", {
      id: linkedSuggestion.id,
    });
    expect(archivedSuggestion.data.first_suggested_by).toBeNull();
    expect(archivedSuggestion.data.shadchan_name).toBeNull();
    const afterArchive = await provider.getList(
      "task_notifications",
      listParams,
    );
    expect(afterArchive.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 9001,
          status: "skipped",
          error: "shadchan archived",
          claimed_at: null,
          next_attempt_at: null,
        }),
        expect.objectContaining({
          id: 9002,
          status: "skipped",
          error: "manual skip",
        }),
      ]),
    );

    await provider.restoreShadchan(target.id);

    const restored = await provider.getList("shadchanim", listParams);
    expect(restored.data.map((row) => row.id)).toContain(target.id);
    const restoredSuggestion = await provider.getOne("shidduchim", {
      id: linkedSuggestion.id,
    });
    expect(restoredSuggestion.data.first_suggested_by).toBe(target.id);
    const afterRestore = await provider.getList(
      "task_notifications",
      listParams,
    );
    expect(afterRestore.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 9001,
          status: "pending",
          error: null,
          claimed_at: null,
          next_attempt_at: null,
        }),
        expect.objectContaining({
          id: 9002,
          status: "skipped",
          error: "manual skip",
        }),
      ]),
    );
  });

  it("enforces the manager role before archiving", async () => {
    const db = generateData();
    const membership = db.account_members.find(
      (candidate) => candidate.account_id === 1 && candidate.user_id === "0",
    );
    expect(membership).toBeDefined();
    if (!membership) return;
    membership.role = "single";
    const target = makeShadchan(9010);
    db.shadchanim.push(target);

    const provider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: "0" }) },
    });

    await expect(provider.archiveShadchan(target.id)).rejects.toThrow(
      "permission",
    );
    const visible = await provider.getList("shadchanim", listParams);
    expect(visible.data.map((row) => row.id)).toContain(target.id);
  });
});

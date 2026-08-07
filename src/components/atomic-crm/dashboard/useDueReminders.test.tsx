import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type {
  Connection,
  Reference,
  ReferenceLink,
  Shadchan,
  Shidduch,
  Single,
  Task,
} from "../types";
import type { UseDueRemindersResult } from "./useDueReminders";
import { MAX_ROWS, useDueReminders } from "./useDueReminders";

/**
 * Task 1 / AC-4, AC-5, AC-6. Real FakeRest data provider (`createDataProvider`,
 * the pattern `dashboard/ShadchanDashboard.test.tsx` establishes) rather than
 * a hand-rolled stub, specifically so the `@in` filter this hook constructs
 * (Task 1: "the app's first production use of `@in`") is exercised through
 * the real `withSupabaseFilterAdapter` -> `transformInFilter` pipeline — a
 * malformed value throws there, which is exactly the failure mode AC-5's
 * "cover the constructed value in the hook's own test" guards against.
 */

const ACCOUNT_ID = 1;
const SINGLE_ID = 501;
const SHIDDUCH_ONE_ID = 601;
const SHIDDUCH_TWO_ID = 602;
const SHADCHAN_ID = 701;
const REFERENCE_ONE_LINK_ID = 801;
const REFERENCE_MULTI_LINK_ID = 802;
const REFERENCE_TIE_ID = 803;
const REFERENCE_UNATTACHED_ID = 804;
// F18: a reference with many links (REFERENCE_HEAVY_ID) and a reference
// whose only link is far older (REFERENCE_SPARSE_ID) — see the "F18 fix"
// describe block below.
const REFERENCE_HEAVY_ID = 805;
const REFERENCE_SPARSE_ID = 806;
// F17: a connection-targeted task, resolved like the other browsable types.
const CONNECTION_ID = 901;
const CONNECTION_HOUSEHOLD_ACCOUNT_ID = 555;

const PAST_DATE = "2020-01-01T00:00:00.000Z";
const FUTURE_DATE = "2999-01-01T00:00:00.000Z";

/** `Task.due_date` is typed `string` (`types.ts:109-119`), but the column is
 * nullable (`01_tables.sql:35`, AC-4) — this local shape is what a fixture
 * actually needs to represent that, without lying about the DB the way the
 * app-wide type intentionally does for every OTHER caller. */
type TaskFixture = Omit<Task, "due_date"> & { due_date: string | null };

const singles: Single[] = [
  {
    id: SINGLE_ID,
    account_id: ACCOUNT_ID,
    first_name_en: "Chana",
    last_name_en: "Levi",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const shidduchBase = {
  account_id: ACCOUNT_ID,
  single_id: SINGLE_ID,
  pipeline_state: "new" as const,
  first_suggested_at: "2026-01-01T00:00:00.000Z",
  redt_date: "2026-01-01T00:00:00.000Z",
  origin: "manual" as const,
  visibility: "shared" as const,
  created_at: "2026-01-01T00:00:00.000Z",
};

const shidduchim: Shidduch[] = [
  { ...shidduchBase, id: SHIDDUCH_ONE_ID, name_en: "Ari Cohen", index: 0 },
  { ...shidduchBase, id: SHIDDUCH_TWO_ID, name_en: "Dovid Katz", index: 1 },
];

const shadchanim: Shadchan[] = [
  {
    id: SHADCHAN_ID,
    account_id: ACCOUNT_ID,
    name: "Rivka Stern",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const references: Reference[] = [
  REFERENCE_ONE_LINK_ID,
  REFERENCE_MULTI_LINK_ID,
  REFERENCE_TIE_ID,
  REFERENCE_UNATTACHED_ID,
  REFERENCE_HEAVY_ID,
  REFERENCE_SPARSE_ID,
].map((id) => ({
  id,
  account_id: ACCOUNT_ID,
  name_en: `Reference #${id}`,
  created_at: "2026-01-01T00:00:00.000Z",
}));

// F17: a single connection, from the household side, exactly the shape
// `targetEntityLabel`'s `"connection"` branch reads (`household_account_name`
// — a connection has no plain `name` column, `reminderEntity.ts`'s own
// comment).
const connections: Connection[] = [
  {
    id: CONNECTION_ID,
    household_account_id: CONNECTION_HOUSEHOLD_ACCOUNT_ID,
    shadchanus_account_id: ACCOUNT_ID,
    status: "accepted",
    proposed_by_account_id: ACCOUNT_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    household_account_name: "The Cohen Family",
  },
];

const referenceLinks: ReferenceLink[] = [
  // AC-6 "one link" — the only candidate wins trivially.
  {
    id: 1,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_ONE_LINK_ID,
    shidduchim_id: SHIDDUCH_ONE_ID,
    created_at: "2026-01-05T00:00:00.000Z",
  },
  // AC-6 "more than one link" — SHIDDUCH_TWO_ID has the latest created_at
  // (Jan 3), so it must win over the two SHIDDUCH_ONE_ID links either side
  // of it in time.
  {
    id: 2,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_MULTI_LINK_ID,
    shidduchim_id: SHIDDUCH_ONE_ID,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 3,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_MULTI_LINK_ID,
    shidduchim_id: SHIDDUCH_TWO_ID,
    created_at: "2026-01-03T00:00:00.000Z",
  },
  {
    id: 4,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_MULTI_LINK_ID,
    shidduchim_id: SHIDDUCH_ONE_ID,
    created_at: "2026-01-02T00:00:00.000Z",
  },
  // AC-6 tie-break — SAME created_at, so the higher `id` (6) must win,
  // resolving to SHIDDUCH_TWO_ID rather than the lower-id SHIDDUCH_ONE_ID.
  {
    id: 5,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_TIE_ID,
    shidduchim_id: SHIDDUCH_ONE_ID,
    created_at: "2026-02-01T00:00:00.000Z",
  },
  {
    id: 6,
    account_id: ACCOUNT_ID,
    reference_id: REFERENCE_TIE_ID,
    shidduchim_id: SHIDDUCH_TWO_ID,
    created_at: "2026-02-01T00:00:00.000Z",
  },
  // REFERENCE_UNATTACHED_ID deliberately has NO rows here at all.
];

function buildDb(tasks: TaskFixture[]) {
  const db = generateData();
  db.singles = singles;
  db.shidduchim = shidduchim;
  db.shadchanim = shadchanim;
  db.references = references;
  db.reference_links = referenceLinks;
  db.connections = connections;
  db.tasks = tasks as unknown as Task[];
  return db;
}

interface RenderHookProbeOptions {
  /** F18: additional `reference_links` rows, merged with the shared
   * `referenceLinks` fixture above — kept OUT of that shared array so the
   * "many links for one reference" scenario doesn't add 150 irrelevant rows
   * to every other test in this file. */
  extraReferenceLinks?: ReferenceLink[];
}

async function renderHookProbe(
  tasks: TaskFixture[],
  options: RenderHookProbeOptions = {},
) {
  const db = buildDb(tasks);
  if (options.extraReferenceLinks) {
    db.reference_links = [...referenceLinks, ...options.extraReferenceLinks];
  }
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  const getListSpy = vi.spyOn(dataProvider, "getList");
  let captured: UseDueRemindersResult | undefined;

  function Probe() {
    captured = useDueReminders();
    return null;
  }

  await render(
    createElement(
      CoreAdminContext,
      { dataProvider, i18nProvider: testI18nProvider },
      createElement(Probe),
    ),
  );

  const getCaptured = (): UseDueRemindersResult => {
    if (!captured) {
      throw new Error("useDueReminders never rendered a result");
    }
    return captured;
  };

  await expect.poll(() => getCaptured().isPending).toBe(false);

  return { getListSpy, getCaptured };
}

const referenceTask = (
  id: number,
  referenceId: number,
  dueDate: string | null,
): TaskFixture => ({
  id,
  account_id: ACCOUNT_ID,
  type: "call",
  text: `Reference task ${id}`,
  due_date: dueDate,
  target_type: "reference",
  target_id: referenceId,
});

describe("useDueReminders — the tasks query (Task 1)", () => {
  it("queries open tasks account-wide, sorted by due_date ascending", async () => {
    // Arrange / Act
    const { getListSpy } = await renderHookProbe([
      referenceTask(1, REFERENCE_ONE_LINK_ID, PAST_DATE),
    ]);

    // Assert — no member_id filter (AC-1: account-wide, not per-assignee).
    expect(getListSpy).toHaveBeenCalledWith("tasks", {
      filter: { "done_date@is": null },
      sort: { field: "due_date", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    });
  });
});

describe("useDueReminders — the @in filter (AC-5, this app's first production use)", () => {
  it("builds the reference_links query filter as a PostgREST string, not an array", async () => {
    // Arrange / Act
    const { getListSpy } = await renderHookProbe([
      referenceTask(1, REFERENCE_ONE_LINK_ID, PAST_DATE),
      referenceTask(2, REFERENCE_MULTI_LINK_ID, FUTURE_DATE),
    ]);

    // Assert
    const referenceLinksCall = getListSpy.mock.calls.find(
      ([resource]) => resource === "reference_links",
    );
    expect(referenceLinksCall).toBeDefined();
    const [, params] = referenceLinksCall!;
    const filterValue = (params as { filter: Record<string, unknown> }).filter[
      "reference_id@in"
    ];
    expect(typeof filterValue).toBe("string");
    expect(filterValue).toMatch(/^\(\d+(,\d+)*\)$/);
  });

  it("does not throw when no reference-targeted task is open (empty @in list)", async () => {
    // Arrange / Act / Assert — the hook itself must not blank the card
    // (`transformInFilter.ts` throws on a malformed, not an empty, value —
    // this pins the empty-list shape never becomes malformed).
    await expect(
      renderHookProbe([
        {
          id: 1,
          account_id: ACCOUNT_ID,
          type: "call",
          text: "A shidduch task",
          due_date: PAST_DATE,
          target_type: "shidduch",
          target_id: SHIDDUCH_ONE_ID,
        },
      ]),
    ).resolves.toBeDefined();
  });
});

describe("useDueReminders — resolving a reference to a shidduch (AC-6)", () => {
  it("resolves a reference with exactly one link to that link's shidduch", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      referenceTask(1, REFERENCE_ONE_LINK_ID, PAST_DATE),
    ]);

    // Assert
    const [row] = getCaptured().rows;
    expect(row.primaryLabel).toBe("Reference #801");
    expect(row.contextLabel).toBe("Ari Cohen");
    expect(row.link).toEqual({ resource: "shidduchim", id: SHIDDUCH_ONE_ID });
  });

  it("resolves a reference with several links to the most recently created one", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      referenceTask(1, REFERENCE_MULTI_LINK_ID, PAST_DATE),
    ]);

    // Assert — Jan 3 link (SHIDDUCH_TWO_ID) beats both the Jan 1 and Jan 2
    // SHIDDUCH_ONE_ID links.
    const [row] = getCaptured().rows;
    expect(row.contextLabel).toBe("Dovid Katz");
    expect(row.link).toEqual({ resource: "shidduchim", id: SHIDDUCH_TWO_ID });
  });

  it("tie-breaks two links sharing the same created_at by the higher link id", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      referenceTask(1, REFERENCE_TIE_ID, PAST_DATE),
    ]);

    // Assert — link id 6 (SHIDDUCH_TWO_ID) beats link id 5 (SHIDDUCH_ONE_ID)
    // even though both share the exact same `created_at`.
    const [row] = getCaptured().rows;
    expect(row.link).toEqual({ resource: "shidduchim", id: SHIDDUCH_TWO_ID });
  });

  it("renders an unattached reference (zero links) as inert text — no link at all", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      referenceTask(1, REFERENCE_UNATTACHED_ID, PAST_DATE),
    ]);

    // Assert — never falls back to `/references/{id}` (AC-6's own "Failing
    // looks like" clause); the row degrades to plain text instead.
    const [row] = getCaptured().rows;
    expect(row.link).toBeNull();
    expect(row.contextLabel).toBeNull();
    expect(row.primaryLabel).toBeTruthy();
  });
});

describe("useDueReminders — F18 fix: reference_links resolution is scoped per reference, not globally paginated", () => {
  it("resolves a sparse reference's own link even when another visible reference has 150+ links", async () => {
    // Arrange — REFERENCE_HEAVY_ID has 150 links, every one created AFTER
    // REFERENCE_SPARSE_ID's single link. The pre-fix implementation ran ONE
    // `reference_id@in` query across BOTH ids sharing a single GLOBAL
    // `perPage: 100`, sorted `created_at DESC`: the 150 heavy rows alone
    // would fill that page (they are all more recent than the sparse
    // reference's one row), pushing the sparse reference's link outside the
    // top 100 and losing it — even though the database holds a perfectly
    // valid link for it. The fix queries each reference id on its own, so
    // the heavy reference's link count can never crowd out another
    // reference's own top-100 pool.
    const heavyLinks: ReferenceLink[] = Array.from({ length: 150 }, (_, i) => ({
      id: 10_000 + i,
      account_id: ACCOUNT_ID,
      reference_id: REFERENCE_HEAVY_ID,
      shidduchim_id: null,
      created_at: new Date(
        Date.UTC(2026, 5, 1 + Math.floor(i / 24), i % 24),
      ).toISOString(),
    }));
    const sparseLink: ReferenceLink = {
      id: 9,
      account_id: ACCOUNT_ID,
      reference_id: REFERENCE_SPARSE_ID,
      shidduchim_id: SHIDDUCH_TWO_ID,
      created_at: "2020-01-01T00:00:00.000Z",
    };

    const { getCaptured } = await renderHookProbe(
      [
        referenceTask(1, REFERENCE_HEAVY_ID, PAST_DATE),
        referenceTask(2, REFERENCE_SPARSE_ID, PAST_DATE),
      ],
      { extraReferenceLinks: [...heavyLinks, sparseLink] },
    );

    // Assert — the sparse reference's own row still resolves its link and
    // shidduch context, proving the heavy reference's 150 links never
    // contended for its query slot.
    const sparseRow = getCaptured().rows.find(
      (row) => row.text === "Reference task 2",
    );
    expect(sparseRow?.link).toEqual({
      resource: "shidduchim",
      id: SHIDDUCH_TWO_ID,
    });
    expect(sparseRow?.contextLabel).toBe("Dovid Katz");
  });
});

describe("useDueReminders — F17 fix: a connection-targeted task resolves like the other browsable types", () => {
  it("resolves a connection task to household_account_name and links to /connections/{id}", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      {
        id: 1,
        account_id: ACCOUNT_ID,
        type: "call",
        text: "Connection task",
        due_date: PAST_DATE,
        target_type: "connection",
        target_id: CONNECTION_ID,
      },
    ]);

    // Assert — `connections` is a registered, routable resource
    // (`root/routeManifest.ts`), so this card resolves it exactly like
    // shidduch/shadchan/single instead of rendering inert text.
    const [row] = getCaptured().rows;
    expect(row.primaryLabel).toBe("The Cohen Family");
    expect(row.contextLabel).toBeNull();
    expect(row.link).toEqual({ resource: "connections", id: CONNECTION_ID });
  });
});

describe("useDueReminders — the three browsable target types (AC-4)", () => {
  it("resolves shidduch/shadchan/single tasks to their own record and link", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      {
        id: 1,
        account_id: ACCOUNT_ID,
        type: "call",
        text: "Shidduch task",
        due_date: PAST_DATE,
        target_type: "shidduch",
        target_id: SHIDDUCH_ONE_ID,
      },
      {
        id: 2,
        account_id: ACCOUNT_ID,
        type: "call",
        text: "Shadchan task",
        due_date: PAST_DATE,
        target_type: "shadchan",
        target_id: SHADCHAN_ID,
      },
      {
        id: 3,
        account_id: ACCOUNT_ID,
        type: "call",
        text: "Single task",
        due_date: PAST_DATE,
        target_type: "single",
        target_id: SINGLE_ID,
      },
    ]);

    // Assert
    const rows = getCaptured().rows;
    const byText = new Map(rows.map((row) => [row.text, row]));
    expect(byText.get("Shidduch task")?.primaryLabel).toBe("Ari Cohen");
    expect(byText.get("Shidduch task")?.link).toEqual({
      resource: "shidduchim",
      id: SHIDDUCH_ONE_ID,
    });
    expect(byText.get("Shadchan task")?.primaryLabel).toBe("Rivka Stern");
    expect(byText.get("Shadchan task")?.link).toEqual({
      resource: "shadchanim",
      id: SHADCHAN_ID,
    });
    expect(byText.get("Single task")?.primaryLabel).toBe("Chana Levi");
    expect(byText.get("Single task")?.link).toEqual({
      resource: "singles",
      id: SINGLE_ID,
    });
  });
});

describe("useDueReminders — a null due_date (AC-4)", () => {
  it("renders no due line and never derives 'Invalid Date'", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe([
      {
        id: 1,
        account_id: ACCOUNT_ID,
        type: "call",
        text: "No due date yet",
        due_date: null,
        target_type: "shidduch",
        target_id: SHIDDUCH_ONE_ID,
      },
    ]);

    // Assert
    const [row] = getCaptured().rows;
    expect(row.dueDate).toBeNull();
    expect(row.isOverdue).toBe(false);
  });
});

describe("useDueReminders — capping at MAX_ROWS (AC-4)", () => {
  it("shows at most MAX_ROWS rows, overdue first, and reports the true totals", async () => {
    // Arrange — 5 open tasks: 2 overdue, 3 upcoming, already the shape the
    // query's own `due_date ASC` sort returns (overdue rows sort first).
    const { getCaptured } = await renderHookProbe([
      referenceTask(1, REFERENCE_ONE_LINK_ID, "2020-01-01T00:00:00.000Z"),
      referenceTask(2, REFERENCE_ONE_LINK_ID, "2020-06-01T00:00:00.000Z"),
      referenceTask(3, REFERENCE_ONE_LINK_ID, FUTURE_DATE),
      referenceTask(4, REFERENCE_ONE_LINK_ID, FUTURE_DATE),
      referenceTask(5, REFERENCE_ONE_LINK_ID, FUTURE_DATE),
    ]);

    // Assert
    const result = getCaptured();
    expect(result.rows).toHaveLength(MAX_ROWS);
    expect(result.rows.map((row) => row.isOverdue)).toEqual([
      true,
      true,
      false,
    ]);
    expect(result.overdueCount).toBe(2);
    expect(result.totalCount).toBe(5);
  });
});

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type {
  GlobalSearchDialogControls,
  UseGlobalSearchResult,
} from "./useGlobalSearch";
import { useGlobalSearch, useGlobalSearchDialog } from "./useGlobalSearch";

/**
 * Task 1/AC 2-5. No JSX — `.test.ts`, not `.test.tsx` — mirrors
 * `useEntityListStatus.test.ts`'s all-`createElement` convention for a
 * hook-only test file.
 *
 * Wraps with `CoreAdminContext` + `ra-data-fakerest` (the pattern
 * `tasks/TasksListFilter.test.tsx` establishes). `ra-data-fakerest`'s own
 * `filterItems` implements a generic `q` full-text scan across every string
 * field of an item (`fakerest/dist/fakerest.js`), which is exactly what the
 * story's Dev Notes mean by "FakeRest generically" already serving `q` —
 * no lifecycle-callback search hook needed for this test, unlike the real
 * Supabase provider.
 */

const FIXTURE_DATA = {
  singles: [
    { id: 1, first_name_en: "Chaya", last_name_en: "Weiss", account_id: 1 },
    { id: 2, first_name_en: "Devora", last_name_en: "Cohen", account_id: 1 },
  ],
  shidduchim: [
    {
      id: 10,
      name_en: "Someone Weiss",
      shadchan_name: "Rivka Stern",
      account_id: 1,
      single_id: 1,
    },
  ],
  shadchanim: [{ id: 20, name: "Weiss Shadchan", account_id: 1 }],
};

function buildDataProvider() {
  return fakeDataProvider(FIXTURE_DATA, true);
}

async function renderHookProbe(query: string) {
  const dataProvider = buildDataProvider();
  const getListSpy = vi.spyOn(dataProvider, "getList");
  let captured: UseGlobalSearchResult | undefined;

  function Probe() {
    captured = useGlobalSearch(query);
    return null;
  }

  await render(
    createElement(
      CoreAdminContext,
      { dataProvider, i18nProvider: testI18nProvider },
      createElement(Probe),
    ),
  );

  const getCaptured = (): UseGlobalSearchResult => {
    if (!captured) {
      throw new Error("useGlobalSearch never rendered a result");
    }
    return captured;
  };

  return { getListSpy, getCaptured };
}

/** Review F5's own tests need a dataProvider that can reject on purpose —
 * `ra-data-fakerest` cannot do that, so these use a hand-rolled stub
 * (mirroring `GlobalSearch.test.tsx`'s own `as unknown as CrmDataProvider`
 * convention). */
async function renderHookProbeWithProvider(
  query: string,
  dataProvider: CrmDataProvider,
) {
  let captured: UseGlobalSearchResult | undefined;

  function Probe() {
    captured = useGlobalSearch(query);
    return null;
  }

  await render(
    createElement(
      CoreAdminContext,
      { dataProvider, i18nProvider: testI18nProvider },
      createElement(Probe),
    ),
  );

  const getCaptured = (): UseGlobalSearchResult => {
    if (!captured) {
      throw new Error("useGlobalSearch never rendered a result");
    }
    return captured;
  };

  return { getCaptured };
}

describe("useGlobalSearch — the minimum-length guard (AC 5)", () => {
  it("resolves three empty groups (present, not omitted) and calls getList zero times for a 1-character query", async () => {
    // Arrange / Act
    const { getListSpy, getCaptured } = await renderHookProbe("c");

    // Assert
    expect(getCaptured().groups).toEqual({
      singles: [],
      shidduchim: [],
      shadchanim: [],
    });
    expect(getCaptured().isPending).toBe(false);
    expect(getListSpy).not.toHaveBeenCalled();
  });

  it("still calls getList zero times for a query that is only whitespace", async () => {
    // Arrange / Act
    const { getListSpy, getCaptured } = await renderHookProbe("  ");

    // Assert
    expect(getCaptured().groups).toEqual({
      singles: [],
      shidduchim: [],
      shadchanim: [],
    });
    expect(getListSpy).not.toHaveBeenCalled();
  });
});

describe("useGlobalSearch — the fan-out (AC 2, AC 3)", () => {
  it("returns three populated groups for a query that matches all three resources", async () => {
    // Arrange / Act
    const { getListSpy, getCaptured } = await renderHookProbe("Weiss");
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert
    expect(getCaptured().groups.singles).toEqual([
      { resource: "singles", id: 1, label_en: "Chaya Weiss", label_he: null },
    ]);
    expect(getCaptured().groups.shidduchim).toEqual([
      {
        resource: "shidduchim",
        id: 10,
        label_en: "Someone Weiss",
        label_he: null,
        subtitle: "Rivka Stern",
      },
    ]);
    expect(getCaptured().groups.shadchanim).toEqual([
      {
        resource: "shadchanim",
        id: 20,
        label_en: "Weiss Shadchan",
        label_he: null,
        subtitle: null,
      },
    ]);

    // AC 3 (setup half): never resolves a path itself — no `href`/path key
    // anywhere on a mapped result. Paths come from `buildRecordPath` at
    // render time (GlobalSearch.tsx), never baked in here.
    for (const group of Object.values(getCaptured().groups)) {
      for (const result of group) {
        expect(result).not.toHaveProperty("href");
        expect(result).not.toHaveProperty("path");
      }
    }

    // Exactly the three `getList` calls Task 1 specifies — resource names,
    // filter, pagination and sort field all pinned so a dead-hook rename
    // (Dev Notes) or a dropped filter fails this test, not silently 400s in
    // production.
    expect(getListSpy).toHaveBeenCalledTimes(3);
    expect(getListSpy).toHaveBeenNthCalledWith(1, "singles", {
      filter: { q: "Weiss" },
      pagination: { page: 1, perPage: 5 },
      sort: { field: "first_name_en", order: "ASC" },
    });
    expect(getListSpy).toHaveBeenNthCalledWith(2, "shidduchim", {
      filter: { q: "Weiss" },
      pagination: { page: 1, perPage: 5 },
      sort: { field: "name_en", order: "ASC" },
    });
    expect(getListSpy).toHaveBeenNthCalledWith(3, "shadchanim", {
      filter: { q: "Weiss" },
      pagination: { page: 1, perPage: 5 },
      sort: { field: "name", order: "ASC" },
    });
  });

  it("returns the other two resources as empty arrays, not omitted keys, when only one resource matches", async () => {
    // Arrange / Act — "Chaya" only appears on the singles fixture.
    const { getCaptured } = await renderHookProbe("Chaya");
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert
    expect(getCaptured().groups.singles).toHaveLength(1);
    expect(Object.keys(getCaptured().groups).sort()).toEqual([
      "shadchanim",
      "shidduchim",
      "singles",
    ]);
    expect(getCaptured().groups.shidduchim).toEqual([]);
    expect(getCaptured().groups.shadchanim).toEqual([]);
  });

  it("returns three empty groups when nothing matches", async () => {
    // Arrange / Act
    const { getListSpy, getCaptured } = await renderHookProbe("Zzyxqvvv");
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert
    expect(getCaptured().groups).toEqual({
      singles: [],
      shidduchim: [],
      shadchanim: [],
    });
    expect(getListSpy).toHaveBeenCalledTimes(3);
  });

  it("resolves hasError: false for a fully successful fan-out", async () => {
    // Arrange / Act
    const { getCaptured } = await renderHookProbe("Weiss");
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert
    expect(getCaptured().hasError).toBe(false);
  });
});

describe("useGlobalSearch — one resource failing (Review F5)", () => {
  it("still resolves the other two groups, and sets hasError, when one resource's getList rejects", async () => {
    // Arrange — `Promise.all` (the pre-fix behaviour) would blank ALL THREE
    // groups on a single rejection; `Promise.allSettled` must not.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dataProvider = {
      getList: vi.fn(async (resource: string) => {
        if (resource === "singles") {
          throw new Error("useGlobalSearch.test.ts: simulated singles failure");
        }
        if (resource === "shidduchim") {
          return { data: FIXTURE_DATA.shidduchim, total: 1 };
        }
        if (resource === "shadchanim") {
          return { data: FIXTURE_DATA.shadchanim, total: 1 };
        }
        throw new Error(`unexpected resource "${resource}"`);
      }),
    } as unknown as CrmDataProvider;

    // Act
    const { getCaptured } = await renderHookProbeWithProvider(
      "Weiss",
      dataProvider,
    );
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert — the failing resource is an empty array (present, not
    // omitted, same AC-5 convention as the "only one resource matches"
    // case above), never blanking its healthy siblings.
    expect(getCaptured().groups.singles).toEqual([]);
    expect(getCaptured().groups.shidduchim).toHaveLength(1);
    expect(getCaptured().groups.shadchanim).toHaveLength(1);
    expect(getCaptured().hasError).toBe(true);

    // Assert — the failure is surfaced (.claude/rules/coding-style.md:
    // "never silently swallow errors"), not just absorbed into an empty
    // array indistinguishable from "no matches".
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("singles"),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("resolves three empty groups and hasError: true when every resource's getList rejects", async () => {
    // Arrange
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dataProvider = {
      getList: vi.fn(async () => {
        throw new Error("useGlobalSearch.test.ts: simulated total failure");
      }),
    } as unknown as CrmDataProvider;

    // Act
    const { getCaptured } = await renderHookProbeWithProvider(
      "Weiss",
      dataProvider,
    );
    await expect.poll(() => getCaptured().isPending).toBe(false);

    // Assert
    expect(getCaptured().groups).toEqual({
      singles: [],
      shidduchim: [],
      shadchanim: [],
    });
    expect(getCaptured().hasError).toBe(true);
    // `ra-core`'s own `useDataProvider()` Proxy also logs every rejected
    // call via a bare `console.error(error)` in non-production builds
    // (`node_modules/ra-core/src/dataProvider/useDataProvider.ts`) — real,
    // expected framework behaviour, not something Story 4.5 controls, and
    // gone in production (`NODE_ENV === "production"` gates it there). This
    // filters those out to isolate OUR OWN per-resource logging.
    const ourErrorLogs = consoleErrorSpy.mock.calls.filter(
      ([message]) =>
        typeof message === "string" &&
        message.includes("Global search fan-out failed"),
    );
    expect(ourErrorLogs).toHaveLength(3);

    consoleErrorSpy.mockRestore();
  });
});

describe("useGlobalSearchDialog — the no-op fallback (Review F8)", () => {
  it("degrades to a no-op, logging via console.error, when used outside a GlobalSearchProvider", async () => {
    // Arrange
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let captured: GlobalSearchDialogControls | undefined;

    function Probe() {
      captured = useGlobalSearchDialog();
      return null;
    }

    // Act
    await render(createElement(Probe));

    // Assert — degrades rather than throwing (mirrors `RecordLink`'s own
    // "degrade, log, never throw" contract for a cross-cutting chrome
    // primitive — see `MISSING_PROVIDER_FALLBACK`'s own doc comment).
    expect(captured?.isOpen).toBe(false);
    expect(() => captured?.open()).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("GlobalSearchProvider"),
    );
    expect(() => captured?.close()).not.toThrow();

    consoleErrorSpy.mockRestore();
  });
});

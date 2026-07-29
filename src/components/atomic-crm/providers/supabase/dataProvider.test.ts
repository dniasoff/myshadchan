import { describe, expect, it } from "vitest";
import type { DataProvider, GetListParams, ResourceCallbacks } from "ra-core";

import { applyFullTextSearch, lifeCycleCallbacks } from "./dataProvider";

/**
 * Review fix, story 4-1 (F1 + F2): Task 4's search wiring — the two
 * `applyFullTextSearch` entries added to `lifeCycleCallbacks` — shipped with
 * no test anywhere in the repo. Re-keying the `singles` hook to
 * `"singles_summary"` (the dead-hook trap the Dev Notes warn about) or
 * swapping a column list for garbage stayed green through
 * typecheck/lint/every vitest project/every CI guard; only this suite
 * exercises the array's actual wiring. See `.claude/rules/testing.md` (AAA).
 */

const buildParams = (filter: Record<string, unknown>): GetListParams => ({
  pagination: { page: 1, perPage: 10 },
  sort: { field: "id", order: "ASC" },
  filter,
});

/**
 * `beforeGetList` is typed as a single callback or an array of them
 * (`ra-core`'s `ResourceCallbacksValue`); every hook this dataProvider
 * defines is a single function, never an array, so narrow that here once
 * rather than repeating the cast at each call site.
 */
const findBeforeGetList = (resource: string) => {
  const hook = lifeCycleCallbacks.find(
    (callback: ResourceCallbacks) => callback.resource === resource,
  );
  if (!hook?.beforeGetList || Array.isArray(hook.beforeGetList)) {
    throw new Error(`expected a single beforeGetList hook for '${resource}'`);
  }
  return hook.beforeGetList as (
    params: GetListParams,
    dataProvider?: DataProvider,
    resource?: string,
  ) => Promise<GetListParams>;
};

describe("applyFullTextSearch (AC 4)", () => {
  it("returns params unchanged when no q filter is present", async () => {
    // Arrange
    const params = buildParams({ "status@eq": "active" });

    // Act
    const result = await applyFullTextSearch(["first_name_en"])(params);

    // Assert
    expect(result).toBe(params);
  });

  it("drops the q filter entirely when it is comma-only (nothing left to search)", async () => {
    // Arrange
    const params = buildParams({ q: ",,," });

    // Act
    const result = await applyFullTextSearch(["first_name_en"])(params);

    // Assert
    expect(result.filter).toEqual({});
  });

  it("builds an @or ilike clause per column for a plain search term", async () => {
    // Arrange
    const params = buildParams({ q: "Chaim" });

    // Act
    const result = await applyFullTextSearch(["first_name_en", "last_name_en"])(
      params,
    );

    // Assert
    expect(result.filter["@or"]).toEqual({
      "first_name_en@ilike": "Chaim",
      "last_name_en@ilike": "Chaim",
    });
  });

  it("special-cases email/phone into the _fts generated columns", async () => {
    // Arrange
    const params = buildParams({ q: "555" });

    // Act
    const result = await applyFullTextSearch(["email", "phone"])(params);

    // Assert
    expect(result.filter["@or"]).toEqual({
      "email_fts@ilike": "555",
      "phone_fts@ilike": "555",
    });
  });

  it("strips a comma out of the search term instead of forwarding it verbatim (F1 — PGRST100)", async () => {
    // Arrange — PostgREST's `or=(...)` syntax is a comma-separated list of
    // conditions with no escaping in this stack; a raw comma here 400s the
    // whole request (PGRST100 "failed to parse logic tree") before RLS runs.
    const params = buildParams({ q: "Cohen, Chaim" });

    // Act
    const result = await applyFullTextSearch(["first_name_en"])(params);

    // Assert — no filter value may contain a literal comma.
    const values = Object.values(
      result.filter["@or"] as Record<string, string>,
    );
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => {
      expect(value).not.toContain(",");
    });
    expect(result.filter["@or"]).toEqual({
      "first_name_en@ilike": "Cohen  Chaim",
    });
  });
});

describe("lifeCycleCallbacks wiring (AC 4, Dev Notes 'the dead-hook trap')", () => {
  it("keys the singles search hook to 'singles', never the redirect target", async () => {
    // Arrange
    const beforeGetList = findBeforeGetList("singles");

    // Act — the real name columns SingleList searches (AC 4).
    const result = await beforeGetList(buildParams({ q: "Chaim" }));

    // Assert
    expect(result.filter["@or"]).toEqual({
      "first_name_en@ilike": "Chaim",
      "last_name_en@ilike": "Chaim",
      "first_name_he@ilike": "Chaim",
      "last_name_he@ilike": "Chaim",
    });
    expect(
      lifeCycleCallbacks.some(
        (callback: ResourceCallbacks) =>
          callback.resource === "singles_summary",
      ),
    ).toBe(false);
  });

  it("keys the shadchanim search hook to 'shadchanim', never the redirect target", async () => {
    // Arrange
    const beforeGetList = findBeforeGetList("shadchanim");

    // Act — the real columns ShadchanList searches (AC 4).
    const result = await beforeGetList(buildParams({ q: "Rivka" }));

    // Assert
    expect(result.filter["@or"]).toEqual({
      "name@ilike": "Rivka",
      "name_he@ilike": "Rivka",
      "location@ilike": "Rivka",
    });
    expect(
      lifeCycleCallbacks.some(
        (callback: ResourceCallbacks) =>
          callback.resource === "shadchanim_summary",
      ),
    ).toBe(false);
  });

  it("neither the singles nor the shadchanim hook 400s on a comma-bearing search (F1)", async () => {
    // Arrange
    const singlesBeforeGetList = findBeforeGetList("singles");
    const shadchanimBeforeGetList = findBeforeGetList("shadchanim");

    // Act
    const singlesResult = await singlesBeforeGetList(
      buildParams({ q: "Cohen, Chaim" }),
    );
    const shadchanimResult = await shadchanimBeforeGetList(
      buildParams({ q: "Stern, Rivka" }),
    );

    // Assert — no @or value contains a raw comma for either hook.
    [singlesResult, shadchanimResult].forEach((result) => {
      Object.values(result.filter["@or"] as Record<string, string>).forEach(
        (value) => {
          expect(value).not.toContain(",");
        },
      );
    });
  });
});

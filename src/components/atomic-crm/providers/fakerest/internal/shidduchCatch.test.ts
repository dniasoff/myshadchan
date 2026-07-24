import type { DataProvider } from "ra-core";

import type { Shidduch } from "../../../types";
import { catchShidduch, computeShidduchCatchCount } from "./shidduchCatch";

/**
 * These tests pin the FakeRest catch engine to the SAME invariants the database
 * enforces (AD-5/FR11): a name match alone never catches, a name plus a
 * corroborator does, the row itself is never a catch of itself, identity is
 * never pooled across accounts, and a prior date is only surfaced when honestly
 * corroborated.
 */

const shidduch = (overrides: Partial<Shidduch>): Shidduch =>
  ({
    id: 0,
    account_id: 1,
    child_id: 10,
    name_en: null,
    name_he: null,
    parents_en: null,
    parents_he: null,
    seminary_en: null,
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: null,
    location_he: null,
    age: null,
    height: null,
    pipeline_state: "new",
    first_suggested_at: "2026-01-01T00:00:00Z",
    redt_date: "2026-01-01",
    origin: "manual",
    visibility: "shared",
    index: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Shidduch;

/** A minimal DataProvider that serves fixed in-memory tables to catchShidduch. */
const providerFor = (tables: Record<string, unknown[]>): DataProvider =>
  ({
    getList: async (resource: string) => ({
      data: (tables[resource] ?? []) as never[],
      total: (tables[resource] ?? []).length,
    }),
  }) as unknown as DataProvider;

describe("computeShidduchCatchCount", () => {
  it("returns zero for a suggestion with no lookalikes", () => {
    // Arrange
    const target = shidduch({
      id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });
    const other = shidduch({
      id: 2,
      name_en: "Dovid Weiss",
      seminary_en: "Mir",
    });

    // Act
    const count = computeShidduchCatchCount(target, [target, other]);

    // Assert
    expect(count).toBe(0);
  });

  it("never catches on a name match alone", () => {
    // Arrange — same name, but nothing corroborates it.
    const target = shidduch({
      id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });
    const other = shidduch({
      id: 2,
      name_en: "Chaim Cohen",
      seminary_en: "Mir",
    });

    // Act
    const count = computeShidduchCatchCount(target, [target, other]);

    // Assert
    expect(count).toBe(0);
  });

  it("catches on a name match corroborated by a shared seminary", () => {
    // Arrange
    const target = shidduch({
      id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Yeshivas Ohr",
    });
    const other = shidduch({
      id: 2,
      name_en: "Chaim Cohen",
      seminary_en: "Yeshivas Ohr",
    });

    // Act
    const count = computeShidduchCatchCount(target, [target, other]);

    // Assert
    expect(count).toBe(1);
  });

  it("never catches a suggestion against itself", () => {
    // Arrange
    const target = shidduch({
      id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });

    // Act
    const count = computeShidduchCatchCount(target, [target]);

    // Assert
    expect(count).toBe(0);
  });

  it("never pools identity across accounts", () => {
    // Arrange — an identical person, but in another account.
    const target = shidduch({
      id: 1,
      account_id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });
    const foreign = shidduch({
      id: 2,
      account_id: 2,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });

    // Act
    const count = computeShidduchCatchCount(target, [target, foreign]);

    // Assert
    expect(count).toBe(0);
  });
});

describe("catchShidduch", () => {
  it("surfaces a prior suggestion of the same person with its deciding facts", async () => {
    // Arrange
    const target = shidduch({
      id: 1,
      child_id: 10,
      name_en: "Chaim Cohen",
      parents_en: "Yaakov Cohen",
    });
    const prior = shidduch({
      id: 2,
      child_id: 11,
      name_en: "Chaim Cohen",
      parents_en: "Yaakov Cohen",
    });
    const provider = providerFor({
      shidduchim: [target, prior],
      children: [{ id: 11, first_name_en: "Rivka" }],
      shadchanim: [],
      date_records: [],
    });

    // Act
    const result = await catchShidduch(provider, 1);

    // Assert
    expect(result.has_catch).toBe(true);
    expect(result.suggestions.map((s) => s.prior_shidduchim_id)).toEqual([2]);
    expect(
      result.suggestions[0].deciding_facts.map((f) => f.signal).sort(),
    ).toEqual(["name", "parents"]);
    expect(result.suggestions[0].child_first_name_en).toBe("Rivka");
  });

  it("never returns the row itself and never catches on name alone", async () => {
    // Arrange — a same-named row with no corroborator must not appear.
    const target = shidduch({
      id: 1,
      name_en: "Chaim Cohen",
      seminary_en: "Ohr",
    });
    const nameOnly = shidduch({
      id: 2,
      name_en: "Chaim Cohen",
      seminary_en: "Mir",
    });
    const provider = providerFor({
      shidduchim: [target, nameOnly],
      children: [],
      shadchanim: [],
      date_records: [],
    });

    // Act
    const result = await catchShidduch(provider, 1);

    // Assert
    expect(result.has_catch).toBe(false);
    expect(result.suggestions).toEqual([]);
  });

  it("surfaces a corroborated prior date but not a name-only one", async () => {
    // Arrange
    const target = shidduch({
      id: 1,
      child_id: 10,
      name_en: "Chaim Cohen",
      seminary_en: "Yeshivas Ohr",
    });
    const provider = providerFor({
      shidduchim: [target],
      children: [{ id: 10, first_name_en: "Leah" }],
      shadchanim: [],
      date_records: [
        {
          id: 100,
          account_id: 1,
          child_id: 10,
          person_name_en: "Chaim Cohen",
          person_seminary: "Yeshivas Ohr",
          outcome: "no_second_date",
          date_on: "2026-01-10",
        },
        {
          id: 101,
          account_id: 1,
          child_id: 10,
          person_name_en: "Chaim Cohen",
          outcome: "ended",
          date_on: "2025-12-01",
        },
      ],
    });

    // Act
    const result = await catchShidduch(provider, 1);

    // Assert
    expect(result.dates.map((d) => d.date_record_id)).toEqual([100]);
    expect(result.has_catch).toBe(true);
  });
});

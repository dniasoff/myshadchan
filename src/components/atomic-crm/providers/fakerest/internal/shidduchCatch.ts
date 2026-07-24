import type { DataProvider, Identifier } from "ra-core";

import type {
  Child,
  DateRecord,
  MatchDecidingFact,
  Shadchan,
  Shidduch,
  ShidduchCatch,
  ShidduchCatchSuggestion,
  ShidduchDatePrior,
} from "../../../types";
import { normalizeIdentityText } from "./referenceIdentity";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;

/**
 * FakeRest mirror of the E3 dedupe "catch" engine (catch_shidduch / the
 * shidduchim_catch_summary view). Like the references match mirror
 * (referenceMatch.ts), this is deliberately a SMALL matcher: exact normalized
 * name equality plus at least one corroborating non-name signal (parents /
 * seminary / shul / location). A name match ALONE never catches -- that is the
 * false-merge invariant the database enforces and this mirror must too.
 *
 * It does NOT reproduce the database's Hebrew/English variant folding
 * (identity_name_key), so demo data with divergent transliterations may catch on
 * the Supabase backend but not here -- exactly the documented limitation of the
 * references match mirror. age/height are never matching signals (FR11).
 */

type Signals = {
  nameEn: string | null;
  nameHe: string | null;
  parents: string | null;
  seminary: string | null;
  shul: string | null;
  location: string | null;
};

type PersonFields = {
  name_en?: string | null;
  name_he?: string | null;
  parents_en?: string | null;
  parents_he?: string | null;
  seminary_en?: string | null;
  seminary_he?: string | null;
  shul_en?: string | null;
  shul_he?: string | null;
  location_en?: string | null;
  location_he?: string | null;
};

const signalsOf = (s: PersonFields): Signals => ({
  nameEn: normalizeIdentityText(s.name_en),
  nameHe: normalizeIdentityText(s.name_he),
  parents: normalizeIdentityText(s.parents_en ?? s.parents_he),
  seminary: normalizeIdentityText(s.seminary_en ?? s.seminary_he),
  shul: normalizeIdentityText(s.shul_en ?? s.shul_he),
  location: normalizeIdentityText(s.location_en ?? s.location_he),
});

const hasName = (a: Signals): boolean => a.nameEn !== null || a.nameHe !== null;

/**
 * The shared gate: a name match plus at least one corroborator, or null. Returns
 * the deciding facts so the panel can show WHY, never just a score.
 */
const gate = (a: Signals, b: Signals): MatchDecidingFact[] | null => {
  const nameHit =
    (a.nameEn !== null && a.nameEn === b.nameEn) ||
    (a.nameHe !== null && a.nameHe === b.nameHe);
  if (!nameHit) return null;

  const facts: MatchDecidingFact[] = [
    { signal: "name", detail: "name matches exactly" },
  ];
  if (a.parents !== null && a.parents === b.parents) {
    facts.push({ signal: "parents", detail: "same parents" });
  }
  if (a.seminary !== null && a.seminary === b.seminary) {
    facts.push({ signal: "school", detail: "same school or seminary" });
  }
  if (a.shul !== null && a.shul === b.shul) {
    facts.push({ signal: "shul", detail: "same shul" });
  }
  if (a.location !== null && a.location === b.location) {
    facts.push({ signal: "location", detail: "same location" });
  }

  const corroborators = facts.length - 1;
  return corroborators === 0 ? null : facts;
};

/** Mirrors match_identity's exact-name scoring (variant paths are DB-only). */
const confidenceOf = (facts: MatchDecidingFact[]): number => {
  const corroborators = facts.filter((f) => f.signal !== "name").length;
  return corroborators >= 2 ? 0.85 : 0.75;
};

/**
 * catch_count for one shidduch: how many OTHER same-account suggestions look
 * like the same person. Used by the shidduchim_summary enricher so the board
 * card's "Suggested before" chip needs no per-card round-trip.
 */
export const computeShidduchCatchCount = (
  target: Shidduch,
  all: Shidduch[],
): number => {
  const a = signalsOf(target);
  if (!hasName(a)) return 0;
  return all.filter(
    (other) =>
      String(other.id) !== String(target.id) &&
      other.account_id === target.account_id &&
      gate(a, signalsOf(other)) !== null,
  ).length;
};

/** FakeRest mirror of catch_shidduch(): prior suggestions + honest prior dates. */
export async function catchShidduch(
  baseDataProvider: DataProvider,
  id: Identifier,
): Promise<ShidduchCatch> {
  const [
    { data: shidduchim },
    { data: children },
    { data: shadchanim },
    dateRecordsResult,
  ] = await Promise.all([
    baseDataProvider.getList<Shidduch>("shidduchim", {
      filter: {},
      pagination: PAGE_ALL,
      sort: { field: "id", order: "ASC" },
    }),
    baseDataProvider.getList<Child>("children", {
      filter: {},
      pagination: PAGE_ALL,
      sort: { field: "id", order: "ASC" },
    }),
    baseDataProvider.getList<Shadchan>("shadchanim", {
      filter: {},
      pagination: PAGE_ALL,
      sort: { field: "id", order: "ASC" },
    }),
    baseDataProvider
      .getList<DateRecord>("date_records", {
        filter: {},
        pagination: PAGE_ALL,
        sort: { field: "id", order: "ASC" },
      })
      .catch(() => ({ data: [] as DateRecord[] })),
  ]);

  const target = shidduchim.find((s) => String(s.id) === String(id));
  if (!target) {
    throw new Error(`shidduch ${id} not found`);
  }

  const childById = new Map(children.map((c) => [String(c.id), c]));
  const shadchanById = new Map(shadchanim.map((s) => [String(s.id), s]));
  const a = signalsOf(target);

  const suggestions: ShidduchCatchSuggestion[] = [];
  if (hasName(a)) {
    for (const ps of shidduchim) {
      if (
        String(ps.id) === String(target.id) ||
        ps.account_id !== target.account_id
      ) {
        continue;
      }
      const facts = gate(a, signalsOf(ps));
      if (!facts) continue;
      const child =
        ps.child_id != null ? childById.get(String(ps.child_id)) : undefined;
      const shadchan =
        ps.shadchan_id != null
          ? shadchanById.get(String(ps.shadchan_id))
          : undefined;
      suggestions.push({
        prior_shidduchim_id: ps.id,
        confidence: confidenceOf(facts),
        deciding_facts: facts,
        name_en: ps.name_en,
        name_he: ps.name_he,
        age: ps.age,
        pipeline_state: ps.pipeline_state,
        first_suggested_at: ps.first_suggested_at,
        redt_date: ps.redt_date,
        child_id: ps.child_id,
        child_first_name_en: child?.first_name_en ?? null,
        child_first_name_he: child?.first_name_he ?? null,
        shadchan_name: shadchan?.name ?? null,
      });
    }
    suggestions.sort(
      (x, y) =>
        y.confidence - x.confidence ||
        Number(x.prior_shidduchim_id) - Number(y.prior_shidduchim_id),
    );
  }

  const dates: ShidduchDatePrior[] = [];
  if (hasName(a)) {
    for (const dr of dateRecordsResult.data) {
      if (dr.account_id !== target.account_id) continue;
      const nameHit =
        (a.nameEn !== null &&
          normalizeIdentityText(dr.person_name_en) === a.nameEn) ||
        (a.nameHe !== null &&
          normalizeIdentityText(dr.person_name_he) === a.nameHe);
      if (!nameHit) continue;
      const corroborated =
        (a.parents !== null &&
          normalizeIdentityText(dr.person_parents) === a.parents) ||
        (a.seminary !== null &&
          normalizeIdentityText(dr.person_seminary) === a.seminary) ||
        (a.location !== null &&
          normalizeIdentityText(dr.person_location) === a.location);
      if (!corroborated) continue;
      const child =
        dr.child_id != null ? childById.get(String(dr.child_id)) : undefined;
      dates.push({
        date_record_id: dr.id,
        person_name_en: dr.person_name_en,
        person_name_he: dr.person_name_he,
        date_on: dr.date_on,
        outcome: dr.outcome,
        child_id: dr.child_id,
        child_first_name_en: child?.first_name_en ?? null,
      });
    }
    dates.sort((x, y) =>
      String(y.date_on ?? "").localeCompare(String(x.date_on ?? "")),
    );
  }

  return {
    has_catch: suggestions.length > 0 || dates.length > 0,
    suggestions,
    dates,
  };
}

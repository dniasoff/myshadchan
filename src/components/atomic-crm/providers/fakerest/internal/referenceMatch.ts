import type { DataProvider, Identifier } from "ra-core";

import type {
  MatchDecidingFact,
  MatchReferenceInput,
  Reference,
  ReferenceLink,
  ReferenceMatchCandidate,
} from "../../../types";
import { normalizeIdentityText, normalizePhone } from "./referenceIdentity";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;

/**
 * FakeRest mirror of match_reference_on_entry() (AD-5). A candidate is
 * returned ONLY when there is a normalized phone match, or a normalized name
 * match corroborated by at least one other signal -- here, school. A name
 * match on its own is never sufficient: that is the hard invariant the
 * database enforces via match_identity()'s scoring, and this mirror must
 * enforce it too, not just approximate it.
 */
export async function matchReferenceOnEntry(
  baseDataProvider: DataProvider,
  input: MatchReferenceInput,
): Promise<ReferenceMatchCandidate[]> {
  const nameEnNorm = normalizeIdentityText(input.name_en);
  const nameHeNorm = normalizeIdentityText(input.name_he);
  const phoneNorm = normalizePhone(input.phone);
  const schoolNorm = normalizeIdentityText(input.school);

  // Nothing identifying was supplied: no candidates, no guessing.
  if (!phoneNorm && !nameEnNorm && !nameHeNorm) {
    return [];
  }

  const [{ data: references }, { data: links }] = await Promise.all([
    baseDataProvider.getList<Reference>("references", {
      filter: {},
      pagination: PAGE_ALL,
      sort: { field: "id", order: "ASC" },
    }),
    baseDataProvider.getList<ReferenceLink>("reference_links", {
      filter: {},
      pagination: PAGE_ALL,
      sort: { field: "id", order: "ASC" },
    }),
  ]);

  const excludeId = input.exclude_id != null ? String(input.exclude_id) : null;

  const candidates = references
    .filter(
      (reference) => excludeId === null || String(reference.id) !== excludeId,
    )
    .map((reference) =>
      buildCandidate(reference, links, {
        nameEnNorm,
        nameHeNorm,
        phoneNorm,
        schoolNorm,
      }),
    )
    .filter(
      (candidate): candidate is ReferenceMatchCandidate => candidate !== null,
    );

  return candidates.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      Number(a.reference_id) - Number(b.reference_id),
  );
}

type QuerySignals = {
  nameEnNorm: string | null;
  nameHeNorm: string | null;
  phoneNorm: string | null;
  schoolNorm: string | null;
};

function buildCandidate(
  reference: Reference,
  links: ReferenceLink[],
  query: QuerySignals,
): ReferenceMatchCandidate | null {
  const phoneHit =
    query.phoneNorm !== null &&
    normalizePhone(reference.phone) === query.phoneNorm;
  const nameHit =
    (query.nameEnNorm !== null &&
      normalizeIdentityText(reference.name_en) === query.nameEnNorm) ||
    (query.nameHeNorm !== null &&
      normalizeIdentityText(reference.name_he) === query.nameHeNorm);
  const schoolHit =
    query.schoolNorm !== null &&
    normalizeIdentityText(reference.school) === query.schoolNorm;

  // The hard invariant: phone alone is enough, but name alone never is --
  // it always needs a corroborating non-name signal (school).
  if (!phoneHit && !(nameHit && schoolHit)) {
    return null;
  }

  const decidingFacts: MatchDecidingFact[] = [];
  if (phoneHit) {
    decidingFacts.push({
      signal: "phone",
      detail: "phone number matches exactly",
    });
  }
  if (nameHit) {
    decidingFacts.push({ signal: "name", detail: "name matches exactly" });
  }
  if (schoolHit) {
    decidingFacts.push({ signal: "school", detail: "same school or seminary" });
  }

  const confidence = phoneHit && nameHit ? 0.98 : phoneHit ? 0.9 : 0.85;

  return {
    reference_id: reference.id,
    confidence,
    deciding_facts: decidingFacts,
    name_en: reference.name_en,
    name_he: reference.name_he,
    phone: reference.phone,
    relationship: reference.relationship,
    school: reference.school,
    grad_year: reference.grad_year,
    linked_shidduchim_count: countLinkedShidduchim(reference.id, links),
  };
}

function countLinkedShidduchim(
  referenceId: Identifier,
  links: ReferenceLink[],
): number {
  const ids = new Set(
    links
      .filter(
        (link) =>
          link.reference_id === referenceId && link.shidduchim_id != null,
      )
      .map((link) => link.shidduchim_id),
  );
  return ids.size;
}

// FakeRest mirror of the normalize_identity_text() / normalize_phone() Postgres
// functions (02_functions.sql) that back match_reference_on_entry (AD-5). This is
// deliberately a SMALL normalizer -- lowercase, strip punctuation/diacritics, fold
// phone prefixes -- not the full nickname/transliteration-variant matcher the
// database builds. The product invariant this exists to protect is "a name match
// alone never returns a candidate" (see referenceMatch.ts), which only needs
// exact normalized equality, not fuzzy variant folding.

// Combining diacritical marks left behind by String.normalize("NFD") on
// accented Latin letters (e.g. e + U+0301 for "é").
const LATIN_DIACRITICS = /[̀-ͯ]/g;
// Hebrew niqqud (vowel points) and cantillation marks.
const HEBREW_NIQQUD_AND_CANTILLATION = /[֑-ׇ]/g;
// Anything that isn't a Latin/Hebrew letter or digit collapses to a space.
const NON_IDENTITY_CHARS = /[^a-z0-9א-ת]+/g;

/**
 * Lowercase, diacritic-stripped, punctuation-collapsed comparison key for a
 * name/school string. Returns null for empty input so callers can treat "no
 * signal" and "no match" the same way the SQL function does.
 */
export function normalizeIdentityText(input?: string | null): string | null {
  if (!input) return null;
  const folded = input
    .normalize("NFD")
    .replace(LATIN_DIACRITICS, "")
    .replace(HEBREW_NIQQUD_AND_CANTILLATION, "")
    .toLowerCase();
  const cleaned = folded.replace(NON_IDENTITY_CHARS, " ").trim();
  return cleaned || null;
}

/**
 * Canonical phone key: digits only, with the IL (+972) / NANP (+1) trunk
 * prefixes and any leading zero stripped, so "054-123-4567" and
 * "+972-54-123-4567" compare equal. Returns null when there are too few
 * digits to trust as a match signal (mirrors normalize_phone()'s length
 * floor) -- a half-typed phone number must never produce a false match.
 */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  let digits = input.replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("972")) {
    digits = digits.slice(3);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("44") && digits.length > 10) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/^0+/, "");

  return digits.length < 7 ? null : digits;
}

export type PhoneLinkResult = {
  /** The unmodified value that was entered by the user. */
  display: string;
  e164: string | null;
  waDigits: string | null;
  status: "ok" | "check";
};

const PHONE_SEPARATORS = /[ ().-]/g;
const FORMAT_OR_DIGIT_ONLY = /^[+0-9 ().-]+$/;
const EXTENSION_SUFFIX = / +(?:x|ext\.?)[ .=-]*[0-9]+$/i;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const invalid = (display: string): PhoneLinkResult => ({
  display,
  e164: null,
  waDigits: null,
  status: "check",
});

const valid = (display: string, digits: string): PhoneLinkResult => ({
  display,
  e164: `+${digits}`,
  waDigits: digits,
  status: "ok",
});

/**
 * A single phone field must not silently choose one of several numbers. This
 * is intentionally a conservative display-only signal; it never participates
 * in href construction.
 */
export const looksLikeMultiplePhoneNumbers = (
  raw: string | null | undefined,
): boolean => {
  if (typeof raw !== "string") return false;
  const digitCount = (raw.match(/[0-9]/g) ?? []).length;
  return /[,;/]/u.test(raw) || /\bor\b/iu.test(raw) || digitCount > 15;
};

/**
 * Keep the entered phone text for display while deriving action URLs from a
 * separately validated value. Raw text must never reach either href.
 */
export const normalizePhoneForLinks = (
  raw: string | null | undefined,
): PhoneLinkResult => {
  const display = typeof raw === "string" ? raw : "";
  if (display.trim() === "") return invalid(display);

  // Directional marks, ZWJ/ZWSP, and other controls are layout or control
  // metadata, not phone characters. Reject them before any trimming so they
  // cannot be normalized into an otherwise valid action URL.
  if (CONTROL_CHARACTERS.test(display)) return invalid(display);

  // The extension rule is intentionally narrow: `x123`/`ext. 123` is accepted
  // only as a whitespace-delimited suffix. Trim ASCII spaces only so other
  // Unicode whitespace cannot disappear before validation. Strings such as
  // `+1;ext=1` stay invalid.
  const candidate = display
    .replace(/^ +| +$/g, "")
    .replace(EXTENSION_SUFFIX, "");

  if (!FORMAT_OR_DIGIT_ONLY.test(candidate)) return invalid(display);

  const compact = candidate.replace(PHONE_SEPARATORS, "");
  const hasLeadingPlus = compact.startsWith("+");
  const withoutPlus = hasLeadingPlus ? compact.slice(1) : compact;

  if (
    withoutPlus === "" ||
    withoutPlus.includes("+") ||
    !/^[0-9]+$/u.test(withoutPlus)
  ) {
    return invalid(display);
  }

  if (hasLeadingPlus) {
    if (
      withoutPlus.startsWith("0") ||
      withoutPlus.length < 8 ||
      withoutPlus.length > 15
    ) {
      return invalid(display);
    }
    return valid(display, withoutPlus);
  }

  if (withoutPlus.startsWith("00")) {
    const internationalDigits = withoutPlus.slice(2);
    if (
      internationalDigits.startsWith("0") ||
      internationalDigits.length < 8 ||
      internationalDigits.length > 15
    ) {
      return invalid(display);
    }
    return valid(display, internationalDigits);
  }

  // A leading zero is a local-format number. We intentionally do not guess a
  // country code for it (including Israeli 05x numbers).
  if (withoutPlus.startsWith("0")) return invalid(display);

  if (withoutPlus.length === 10) return valid(display, `1${withoutPlus}`);
  if (withoutPlus.length === 11 && withoutPlus.startsWith("1")) {
    return valid(display, withoutPlus);
  }

  return invalid(display);
};

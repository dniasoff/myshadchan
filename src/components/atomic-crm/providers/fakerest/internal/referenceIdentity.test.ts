import { normalizeIdentityText, normalizePhone } from "./referenceIdentity";

describe("normalizeIdentityText", () => {
  it("returns null for empty or missing input", () => {
    // Arrange / Act / Assert
    expect(normalizeIdentityText(null)).toBeNull();
    expect(normalizeIdentityText(undefined)).toBeNull();
    expect(normalizeIdentityText("")).toBeNull();
  });

  it("lowercases and trims", () => {
    // Arrange
    const input = "  Chaim Feldman  ";
    // Act
    const result = normalizeIdentityText(input);
    // Assert
    expect(result).toBe("chaim feldman");
  });

  it("strips Latin diacritics so accented and plain spellings match", () => {
    // Arrange / Act
    const accented = normalizeIdentityText("José Álvarez");
    const plain = normalizeIdentityText("Jose Alvarez");
    // Assert
    expect(accented).toBe(plain);
  });

  it("strips punctuation and collapses whitespace", () => {
    // Arrange / Act
    const result = normalizeIdentityText("O'Brien-Smith,   Jr.");
    // Assert
    expect(result).toBe("o brien smith jr");
  });

  it("strips Hebrew niqqud so pointed and unpointed spellings match", () => {
    // Arrange / Act
    const pointed = normalizeIdentityText("חַיִּים");
    const unpointed = normalizeIdentityText("חיים");
    // Assert
    expect(pointed).toBe(unpointed);
  });

  it("does NOT fold name variants (Chaim vs Haim stay different keys)", () => {
    // Arrange / Act
    const a = normalizeIdentityText("Chaim Feldman");
    const b = normalizeIdentityText("Haim Feldman");
    // Assert -- this is deliberate: the FakeRest mirror is a small
    // normalizer, not the full nickname-folding matcher (AD-5's full scheme
    // lives server-side only).
    expect(a).not.toBe(b);
  });
});

describe("normalizePhone", () => {
  it("returns null for empty or missing input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null when there are too few digits to trust as a signal", () => {
    // Arrange
    const input = "12345";
    // Act
    const result = normalizePhone(input);
    // Assert
    expect(result).toBeNull();
  });

  it("strips a leading trunk zero", () => {
    expect(normalizePhone("054-222-3344")).toBe("542223344");
  });

  it("strips the IL country code (+972) so it matches the trunk-zero form", () => {
    // Arrange / Act
    const withCountryCode = normalizePhone("+972-54-222-3344");
    const withTrunkZero = normalizePhone("054-222-3344");
    // Assert
    expect(withCountryCode).toBe(withTrunkZero);
  });

  it("strips a NANP (+1) country code from an 11-digit US number", () => {
    // Arrange / Act
    const result = normalizePhone("+1 (201) 555-4471");
    // Assert
    expect(result).toBe("2015554471");
  });

  it("ignores punctuation and whitespace", () => {
    expect(normalizePhone("(201) 555-4471")).toBe("2015554471");
  });
});

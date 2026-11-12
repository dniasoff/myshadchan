import {
  capitalizeName,
  countSuggestionsByShadchan,
  filterShadchanimBySearch,
  getShadchanPhoneMatch,
  isResponsivenessLevel,
  normalizeShadchanName,
  normalizePhoneDigits,
  parseContactInfo,
} from "./shadchanUtils";

const shadchan = (id: number, contacts: unknown, name = `Shadchan ${id}`) => ({
  id,
  account_id: 1,
  name,
  contacts,
  created_at: "2026-01-01T00:00:00Z",
});

describe("phone search matching", () => {
  it("normalizes punctuation and one leading international 00 prefix", () => {
    expect(normalizePhoneDigits("+44 (7700) 900-123")).toBe("447700900123");
    expect(normalizePhoneDigits("00 44.7700.900.123")).toBe("447700900123");
  });

  it("drops extension markers from stored values and typed queries", () => {
    expect(normalizePhoneDigits("555-1234 x12")).toBe("5551234");
    expect(normalizePhoneDigits("(212) 555-1234 EXT 12")).toBe("2125551234");
    expect(normalizePhoneDigits("(212) 555-1234 ext. 12")).toBe("2125551234");
    expect(normalizePhoneDigits("(212) 555-1234 extn 12")).toBe("2125551234");
    expect(normalizePhoneDigits("(212) 555-1234 extension 12")).toBe(
      "2125551234",
    );
    expect(normalizePhoneDigits("212-555-1234 #5")).toBe("2125551234");

    expect(
      getShadchanPhoneMatch(
        shadchan(1, { phone: "555-1234 x12" }),
        "5551234 ext 99",
      ),
    ).toEqual({
      channels: ["phone"],
      suffix: "1234",
    });
    expect(
      getShadchanPhoneMatch(shadchan(2, { phone: "555-1234 x12" }), "3412"),
    ).toBeNull();
    expect(
      getShadchanPhoneMatch(shadchan(3, { phone: "call after 5" }), "5"),
    ).toBeNull();
  });

  it("matches each number in slash, comma, semicolon, or word-separated values", () => {
    const candidate = shadchan(1, {
      phone:
        "0501234567 / 0527654321, 0531234567; 0547654321 or 0551234567 and 0567654321",
    });

    for (const query of [
      "1234567",
      "7654321",
      "0547654321",
      "0551234567",
      "0567654321",
    ]) {
      expect(getShadchanPhoneMatch(candidate, query)).toEqual({
        channels: ["phone"],
        suffix: query.slice(-4),
      });
    }
  });

  it("matches international and local formats by trailing digits", () => {
    const candidate = shadchan(1, { phone: "+44 7700 900123" });

    expect(getShadchanPhoneMatch(candidate, "07700 900123")).toEqual({
      channels: ["phone"],
      suffix: "0123",
    });
    expect(getShadchanPhoneMatch(candidate, "7700900123")).toEqual({
      channels: ["phone"],
      suffix: "0123",
    });
    expect(getShadchanPhoneMatch(candidate, "0123")).toEqual({
      channels: ["phone"],
      suffix: "0123",
    });
    expect(getShadchanPhoneMatch(candidate, "900")).toBeNull();
  });

  it("searches WhatsApp and numbered phone-like contact keys without reading email", () => {
    const candidate = shadchan(1, {
      email: "900123@example.com",
      mobile_2: "+1 555 900 0123",
      mobile_3: "+1 555 900 1234",
      whatsapp: "044 7700 9000123",
      notes: "7700900123",
    });

    expect(getShadchanPhoneMatch(candidate, "9000123")).toEqual({
      channels: ["phone", "whatsapp"],
      suffix: "0123",
    });
    expect(getShadchanPhoneMatch(candidate, "1234")).toEqual({
      channels: ["phone"],
      suffix: "1234",
    });
    expect(getShadchanPhoneMatch(candidate, "0000")).toBeNull();
  });

  it("lists every suffix collision and preserves text search", () => {
    const rows = [
      shadchan(1, { phone: "+1 555 900 0123" }, "Rivka Stern"),
      shadchan(2, { whatsapp: "+44 7700 9000123" }, "Moshe Adler"),
      shadchan(3, { phone: "+972 50 700 9999" }, "Leah Cohen"),
    ];

    expect(
      filterShadchanimBySearch(rows, "9000123").map((row) => row.id),
    ).toEqual([1, 2]);
    expect(
      filterShadchanimBySearch(rows, "Stern, Rivka").map((row) => row.id),
    ).toEqual([1]);
  });
});

describe("capitalizeName", () => {
  it("capitalizes the first letter of each lower-case word without lower-casing the rest", () => {
    expect(capitalizeName("rivka cohen")).toBe("Rivka Cohen");
    expect(capitalizeName("de la Cruz")).toBe("De La Cruz");
    expect(capitalizeName("McKay O'Neil")).toBe("McKay O'Neil");
  });

  it("handles hyphenated names, whitespace and Hebrew without mangling text", () => {
    expect(capitalizeName("mary-jane  levy")).toBe("Mary-Jane  Levy");
    expect(capitalizeName("  רחל לוי  ")).toBe("  רחל לוי  ");
  });

  it("is safe for empty input", () => {
    expect(capitalizeName("")).toBe("");
    expect(capitalizeName(null)).toBe("");
    expect(capitalizeName(undefined)).toBe("");
  });
});

describe("normalizeShadchanName", () => {
  it("normalizes the name in a form record while preserving other fields", () => {
    const record = { name: "rivka cohen", location: "Jerusalem" };

    expect(normalizeShadchanName(record)).toEqual({
      name: "Rivka Cohen",
      location: "Jerusalem",
    });
  });

  it("leaves records without a string name unchanged", () => {
    const record = { name: null, location: "Jerusalem" };

    expect(normalizeShadchanName(record)).toBe(record);
  });
});

describe("parseContactInfo", () => {
  it("reads phone, email and whatsapp from a well-formed contacts object", () => {
    // Arrange
    const contacts = {
      phone: "555-0100",
      email: "sarah@example.com",
      whatsapp: "555-0101",
    };
    // Act
    const result = parseContactInfo(contacts);
    // Assert
    expect(result).toEqual({
      phone: "555-0100",
      email: "sarah@example.com",
      whatsapp: "555-0101",
    });
  });

  it("returns an empty object for null or undefined", () => {
    expect(parseContactInfo(null)).toEqual({});
    expect(parseContactInfo(undefined)).toEqual({});
  });

  it("returns an empty object when contacts is not a plain object", () => {
    expect(parseContactInfo("not-an-object")).toEqual({});
    expect(parseContactInfo(42)).toEqual({});
    expect(parseContactInfo(["phone", "555"])).toEqual({});
  });

  it("drops non-string values instead of throwing", () => {
    // Arrange
    const contacts = { phone: 5550100, email: null, whatsapp: "555-0101" };
    // Act
    const result = parseContactInfo(contacts);
    // Assert
    expect(result).toEqual({ whatsapp: "555-0101" });
  });

  it("omits empty-string fields", () => {
    expect(parseContactInfo({ phone: "" })).toEqual({});
  });
});

describe("isResponsivenessLevel", () => {
  it("accepts the three known levels", () => {
    expect(isResponsivenessLevel("high")).toBe(true);
    expect(isResponsivenessLevel("medium")).toBe(true);
    expect(isResponsivenessLevel("low")).toBe(true);
  });

  it("rejects anything else, including null and undefined", () => {
    expect(isResponsivenessLevel("urgent")).toBe(false);
    expect(isResponsivenessLevel(null)).toBe(false);
    expect(isResponsivenessLevel(undefined)).toBe(false);
    expect(isResponsivenessLevel(3)).toBe(false);
  });
});

describe("countSuggestionsByShadchan", () => {
  it("counts how many suggestions belong to each shadchan_id", () => {
    // Arrange
    const items = [{ shadchan_id: 1 }, { shadchan_id: 1 }, { shadchan_id: 2 }];
    // Act
    const result = countSuggestionsByShadchan(items);
    // Assert
    expect(result.get(1)).toBe(2);
    expect(result.get(2)).toBe(1);
  });

  it("ignores rows with no shadchan_id", () => {
    // Arrange
    const items = [{ shadchan_id: null }, { shadchan_id: undefined }, {}];
    // Act
    const result = countSuggestionsByShadchan(items);
    // Assert
    expect(result.size).toBe(0);
  });

  it("returns an empty map for an empty list", () => {
    expect(countSuggestionsByShadchan([]).size).toBe(0);
  });
});

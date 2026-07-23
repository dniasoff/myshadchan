import {
  countSuggestionsByShadchan,
  isResponsivenessLevel,
  parseContactInfo,
} from "./shadchanUtils";

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
    const items = [
      { shadchan_id: 1 },
      { shadchan_id: 1 },
      { shadchan_id: 2 },
    ];
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

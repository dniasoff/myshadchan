import { describe, expect, it } from "vitest";

import {
  LINKABLE_TARGET_TYPES,
  RESOURCE_FOR_TARGET,
  TARGET_TYPE_LABEL,
  TARGET_TYPE_LABEL_PLURAL,
  targetEntityLabel,
} from "./reminderEntity";

/**
 * AC 5 — the two live AD-23 violations (the retired placeholder word for a
 * shidduch) are fixed, `single` is added everywhere the widened
 * `TaskTargetType` union now requires it. `LINKABLE_TARGET_TYPES` itself
 * still excludes `single` (a separate, pre-existing gap Story 3.8 owns —
 * unrelated to Story 8.5's own `connection` addition here).
 *
 * Story 8.5 (Task 8, contract §8 rule 4): `connection` joins
 * `LINKABLE_TARGET_TYPES` and all three `Record<TaskTargetType, string>`
 * maps below, plus `targetEntityLabel`'s own `connection` case.
 */

describe("TARGET_TYPE_LABEL — AD-23 vocabulary", () => {
  it("labels shidduch as 'Shidduch', never the retired 'Suggestion'", () => {
    // Assert
    expect(TARGET_TYPE_LABEL.shidduch).toBe("Shidduch");
  });

  it("has a label for every TaskTargetType, including single and connection", () => {
    // Assert
    expect(TARGET_TYPE_LABEL).toEqual({
      shidduch: "Shidduch",
      reference: "Reference",
      shadchan: "Shadchan",
      single: "Single",
      connection: "Connection",
    });
  });
});

describe("TARGET_TYPE_LABEL_PLURAL — avoids the naive '+ s' AD-23 regression", () => {
  it("pluralizes shidduch as shidduchim, not shidduchs", () => {
    // Assert
    expect(TARGET_TYPE_LABEL_PLURAL.shidduch).toBe("shidduchim");
  });

  it("has a plural for every TaskTargetType", () => {
    // Assert
    expect(TARGET_TYPE_LABEL_PLURAL).toEqual({
      shidduch: "shidduchim",
      reference: "references",
      shadchan: "shadchanim",
      single: "singles",
      connection: "connections",
    });
  });
});

describe("RESOURCE_FOR_TARGET", () => {
  it("maps every TaskTargetType to its backing resource, including single -> singles and connection -> connections", () => {
    // Assert
    expect(RESOURCE_FOR_TARGET).toEqual({
      shidduch: "shidduchim",
      reference: "references",
      shadchan: "shadchanim",
      single: "singles",
      connection: "connections",
    });
  });
});

describe("targetEntityLabel", () => {
  it("returns the single's first + last name when a record is present", () => {
    // Act
    const result = targetEntityLabel("single", {
      first_name_en: "Rivky",
      last_name_en: "Klein",
    });

    // Assert
    expect(result.label).toBe("Rivky Klein");
  });

  it("falls back to 'Single' when no record is present", () => {
    // Act
    const result = targetEntityLabel("single", undefined);

    // Assert
    expect(result.label).toBe("Single");
  });

  it("falls back to 'Single' when the record has neither first nor last name", () => {
    // Act
    const result = targetEntityLabel("single", {});

    // Assert
    expect(result.label).toBe("Single");
  });

  it("falls back to 'Shidduch' (not 'Suggestion') for a nameless shidduch record", () => {
    // Act
    const result = targetEntityLabel("shidduch", {});

    // Assert
    expect(result.label).toBe("Shidduch");
  });

  it("uses name_en when present for a shidduch record", () => {
    // Act
    const result = targetEntityLabel("shidduch", { name_en: "Chaim Cohen" });

    // Assert
    expect(result.label).toBe("Chaim Cohen");
  });

  it("uses the type's calm label when no record has loaded yet", () => {
    // Act
    const result = targetEntityLabel("shadchan", undefined);

    // Assert
    expect(result.label).toBe("Shadchan");
  });

  it("uses household_account_name for a connection record (Story 8.5) — never falls through to the shadchan/default branch", () => {
    // Act
    const result = targetEntityLabel("connection", {
      household_account_name: "The Klein Family",
    });

    // Assert
    expect(result.label).toBe("The Klein Family");
  });

  it("falls back to 'Connection' (not 'Shadchan') for a connection record with no household_account_name", () => {
    // Act
    const result = targetEntityLabel("connection", {});

    // Assert
    expect(result.label).toBe("Connection");
  });

  it("falls back to 'Connection' when no record has loaded yet", () => {
    // Act
    const result = targetEntityLabel("connection", undefined);

    // Assert
    expect(result.label).toBe("Connection");
  });
});

describe("LINKABLE_TARGET_TYPES", () => {
  it("has exactly four entries and does not offer 'single' yet (Story 3.8's own gap, unrelated to Story 8.5)", () => {
    // Assert — tasks_target_type_check (01_tables.sql) does not accept
    // 'single' until Story 3.8 widens LINKABLE_TARGET_TYPES itself; offering
    // it here first would let this picker submit an insert Postgres rejects.
    expect(LINKABLE_TARGET_TYPES).toHaveLength(4);
    expect(LINKABLE_TARGET_TYPES).not.toContain("single");
  });

  it("includes 'connection' (Story 8.5, Task 8)", () => {
    // Assert
    expect(LINKABLE_TARGET_TYPES).toContain("connection");
  });
});

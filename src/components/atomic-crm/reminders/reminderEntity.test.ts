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
 * `TaskTargetType` union now requires it,
 * and `LINKABLE_TARGET_TYPES` deliberately stays at three (Story 3.8 adds
 * `single` there in the same diff as the `tasks_target_type_check` widening
 * — this file's own `LINKABLE_TARGET_TYPES` test below is MEANT to be
 * edited by that story, not treated as a permanent invariant).
 */

describe("TARGET_TYPE_LABEL — AD-23 vocabulary", () => {
  it("labels shidduch as 'Shidduch', never the retired 'Suggestion'", () => {
    // Assert
    expect(TARGET_TYPE_LABEL.shidduch).toBe("Shidduch");
  });

  it("has a label for every TaskTargetType, including single", () => {
    // Assert
    expect(TARGET_TYPE_LABEL).toEqual({
      shidduch: "Shidduch",
      reference: "Reference",
      shadchan: "Shadchan",
      single: "Single",
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
    });
  });
});

describe("RESOURCE_FOR_TARGET", () => {
  it("maps every TaskTargetType to its backing resource, including single -> singles", () => {
    // Assert
    expect(RESOURCE_FOR_TARGET).toEqual({
      shidduch: "shidduchim",
      reference: "references",
      shadchan: "shadchanim",
      single: "singles",
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
});

describe("LINKABLE_TARGET_TYPES — meant to be edited by Story 3.8, not this story", () => {
  it("has exactly three entries and does not offer 'single' yet", () => {
    // Assert — tasks_target_type_check (01_tables.sql) does not accept
    // 'single' until Story 3.8 widens it; offering it here first would let
    // this picker submit an insert Postgres rejects.
    expect(LINKABLE_TARGET_TYPES).toHaveLength(3);
    expect(LINKABLE_TARGET_TYPES).not.toContain("single");
  });
});

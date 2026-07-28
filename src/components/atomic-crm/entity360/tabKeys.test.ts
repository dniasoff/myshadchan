import { describe, expect, it } from "vitest";

import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";
import { isTabKey, TAB_KEYS, tabLabelKey, type TabKey } from "./tabKeys";

/**
 * Contract §3's own 15-key list, transcribed independently of `tabKeys.ts`'s
 * export. A rename of a shipped key (e.g. `sed`-replacing "shidduchim" with
 * something else) would satisfy the type system trivially — this catches it
 * instead. Deliberately not asserting `TAB_KEYS.length`: contract §3 rule 3
 * makes adding a key a sanctioned one-line edit, and a length pin would
 * fight that.
 */
const CONTRACT_TAB_KEYS = [
  "overview",
  "activity",
  "notes",
  "tasks",
  "files",
  "related",
  "resume",
  "photo",
  "medical",
  "diligence",
  "external-links",
  "shidduchim",
  "conversations",
  "discussions",
  "assistant",
];

describe("TAB_KEYS — AC 1", () => {
  it("contains every key named in contract §3", () => {
    for (const key of CONTRACT_TAB_KEYS) {
      expect(TAB_KEYS).toContain(key);
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(TAB_KEYS).size).toBe(TAB_KEYS.length);
  });
});

describe("isTabKey — AC 2 runtime narrowing", () => {
  it("returns true for every canonical key", () => {
    for (const key of TAB_KEYS) {
      expect(isTabKey(key)).toBe(true);
    }
  });

  it("returns false for the retired 'suggestions' name", () => {
    expect(isTabKey("suggestions")).toBe(false);
  });

  it("returns false for the retired 'linked-shidduchim' name", () => {
    expect(isTabKey("linked-shidduchim")).toBe(false);
  });

  it("returns false for an arbitrary unknown string", () => {
    expect(isTabKey("not-a-tab")).toBe(false);
  });
});

describe("tabLabelKey", () => {
  it("namespaces every key under crm.entity360.tab", () => {
    for (const key of TAB_KEYS) {
      expect(tabLabelKey(key)).toBe(`crm.entity360.tab.${key}`);
    }
  });
});

describe("TabKey — AC 2 retired names are not expressible", () => {
  it("rejects 'suggestions' as a TabKey at compile time", () => {
    // @ts-expect-error — "suggestions" was retired in favour of "shidduchim" (contract §3)
    const value: TabKey = "suggestions";
    expect(value).toBeDefined();
  });

  it("rejects 'linked-shidduchim' as a TabKey at compile time", () => {
    // @ts-expect-error — "linked-shidduchim" was retired in favour of "shidduchim" (contract §3)
    const value: TabKey = "linked-shidduchim";
    expect(value).toBeDefined();
  });

  it("rejects 'linked-shidduchim' as an EntityRelationshipDescriptor key at compile time", () => {
    const descriptor: EntityRelationshipDescriptor = {
      // @ts-expect-error — retired key; relationships are keyed by TabKey (AC 6)
      key: "linked-shidduchim",
      resource: "shidduchim",
      getFilter: () => ({}),
    };
    expect(descriptor).toBeDefined();
  });
});

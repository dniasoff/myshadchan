import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { EntityTabDescriptor } from "./entityDescriptor";
import { mergeEntityTabs } from "./mergeEntityTabs";
import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";
import { RelatedRecordsTab } from "./tabs/RelatedRecordsTab";

const fixtureRelationship: EntityRelationshipDescriptor = {
  key: "shidduchim",
  resource: "fixture-related-resource",
  getFilter: (record) => ({ subject_id: record.id }),
};

describe("mergeEntityTabs — no relationships", () => {
  it("returns the explicit tabs array unchanged, in the order it was declared", () => {
    // Arrange
    const tabs: EntityTabDescriptor[] = [
      { key: "overview", render: () => null },
      { key: "notes", render: () => null },
    ];

    // Act
    const merged = mergeEntityTabs(tabs, []);

    // Assert
    expect(merged).toEqual(tabs);
  });

  it("defaults both arguments, returning an empty array for a tab-less, relationship-less descriptor", () => {
    expect(mergeEntityTabs()).toEqual([]);
  });
});

describe("mergeEntityTabs — relationships become tabs (AC 10)", () => {
  it("turns a relationship into a tab rendering RelatedRecordsTab, appended after the explicit tabs", () => {
    // Arrange
    const tabs: EntityTabDescriptor[] = [
      { key: "overview", render: () => null },
      { key: "notes", render: () => null },
    ];

    // Act
    const merged = mergeEntityTabs(tabs, [fixtureRelationship]);

    // Assert — declared order: explicit tabs first, then the relationship,
    // in the order the relationships array declares it.
    expect(merged.map((tab) => tab.key)).toEqual([
      "overview",
      "notes",
      "shidduchim",
    ]);
    const relationshipTab = merged[2];
    const rendered = relationshipTab.render();
    expect(isValidElement(rendered)).toBe(true);
    expect(rendered).toMatchObject({
      type: RelatedRecordsTab,
      props: { relationship: fixtureRelationship },
    });
  });

  it("renders a relationships-only descriptor's tab too, with no explicit tabs at all", () => {
    // Act
    const merged = mergeEntityTabs([], [fixtureRelationship]);

    // Assert
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe("shidduchim");
  });

  it("forwards a relationship's label verbatim, including undefined (never substitutes TAB_LABELS)", () => {
    // Arrange
    const labelledRelationship: EntityRelationshipDescriptor = {
      ...fixtureRelationship,
      label: "Custom override",
    };

    // Act
    const withoutLabel = mergeEntityTabs([], [fixtureRelationship]);
    const withLabel = mergeEntityTabs([], [labelledRelationship]);

    // Assert
    expect(withoutLabel[0].label).toBeUndefined();
    expect(withLabel[0].label).toBe("Custom override");
  });
});

describe("mergeEntityTabs — an explicit tabs entry overrides the relationship (AC 10)", () => {
  it("keeps exactly one tab for the shared key, rendering the explicit content, not RelatedRecordsTab", () => {
    // Arrange
    const explicitRender = vi.fn(() => null);
    const tabs: EntityTabDescriptor[] = [
      { key: "shidduchim", render: explicitRender },
    ];

    // Act
    const merged = mergeEntityTabs(tabs, [fixtureRelationship]);

    // Assert — one tab only, and it is the explicit one.
    expect(merged).toHaveLength(1);
    expect(merged[0].render).toBe(explicitRender);
  });
});

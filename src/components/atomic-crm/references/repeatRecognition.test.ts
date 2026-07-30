import { describe, expect, it } from "vitest";

import type { ReferenceLinkSummary } from "../types";
import {
  countOtherConversations,
  filterOtherConversations,
} from "./repeatRecognition";

/**
 * Story 5.10, Task 1: the shared predicate extracted out of
 * `RepeatRecognitionPanel.tsx`'s own `others` computation, unit-tested on
 * its own so `ShidduchReferencesSection.tsx` and `RepeatRecognitionPanel.tsx`
 * can both rely on it without re-deriving the edge cases.
 */

let nextId = 1;
const buildLink = (
  overrides: Partial<ReferenceLinkSummary> = {},
): ReferenceLinkSummary => ({
  id: nextId++,
  account_id: 1,
  reference_id: 1,
  shidduchim_id: 10,
  call_status: "not_started",
  created_at: "2026-01-01T00:00:00Z",
  conversation_log_count: 0,
  ...overrides,
});

describe("filterOtherConversations", () => {
  it("excludes a link naming the excluded shidduch", () => {
    // Arrange
    const links = [
      buildLink({ shidduchim_id: 10 }),
      buildLink({ shidduchim_id: 11 }),
    ];

    // Act
    const others = filterOtherConversations(links, 10);

    // Assert
    expect(others.map((link) => link.shidduchim_id)).toEqual([11]);
  });

  it("excludes a link with no shidduch at all", () => {
    // Arrange
    const links = [
      buildLink({ shidduchim_id: null }),
      buildLink({ shidduchim_id: 11 }),
    ];

    // Act
    const others = filterOtherConversations(links, undefined);

    // Assert
    expect(others.map((link) => link.shidduchim_id)).toEqual([11]);
  });

  it("returns every link when nothing is excluded and every link names a shidduch", () => {
    // Arrange
    const links = [
      buildLink({ shidduchim_id: 10 }),
      buildLink({ shidduchim_id: 11 }),
    ];

    // Act
    const others = filterOtherConversations(links);

    // Assert
    expect(others).toHaveLength(2);
  });
});

describe("countOtherConversations", () => {
  it("returns the count of filterOtherConversations, not the raw link count", () => {
    // Arrange
    const links = [
      buildLink({ shidduchim_id: 10 }),
      buildLink({ shidduchim_id: 11 }),
      buildLink({ shidduchim_id: null }),
    ];

    // Act / Assert
    expect(countOtherConversations(links, 10)).toBe(1);
  });

  it("returns 0 for an empty link list", () => {
    expect(countOtherConversations([], 10)).toBe(0);
  });
});

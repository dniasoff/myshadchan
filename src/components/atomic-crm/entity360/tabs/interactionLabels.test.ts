import { describe, expect, it } from "vitest";

import {
  formatTimelineDate,
  INTERACTION_KIND_LABELS,
} from "./interactionLabels";

/**
 * Story 3.5 AC 7. `Record<InteractionKind, …>` already makes "every
 * InteractionKind has an entry" a compile-time guarantee (a missing key is a
 * `tsc` error) — this file's job is the label TEXT, not the keys' mere
 * existence, and the two wording changes AC 7 makes on purpose.
 */

describe("formatTimelineDate — moved verbatim from ShidduchTimeline.tsx", () => {
  it("formats an ISO timestamp as 'd MMM yyyy, HH:mm'", () => {
    // Act / Assert
    expect(formatTimelineDate("2026-03-05T14:07:00.000Z")).toMatch(
      /^5 Mar 2026, \d{2}:\d{2}$/,
    );
  });

  it("returns the input string unchanged when it does not parse as a date", () => {
    // Act / Assert
    expect(formatTimelineDate("not-a-date")).toBe("not-a-date");
  });
});

describe("INTERACTION_KIND_LABELS — one entry per InteractionKind, under crm.entity360.activity.kind.<kind>", () => {
  it("note", () => {
    expect(INTERACTION_KIND_LABELS.note).toEqual({
      key: "crm.entity360.activity.kind.note",
      fallback: "Note",
    });
  });

  it("call_logged", () => {
    expect(INTERACTION_KIND_LABELS.call_logged).toEqual({
      key: "crm.entity360.activity.kind.call_logged",
      fallback: "Call logged",
    });
  });

  it("status_change", () => {
    expect(INTERACTION_KIND_LABELS.status_change).toEqual({
      key: "crm.entity360.activity.kind.status_change",
      fallback: "Status changed",
    });
  });

  it("merge", () => {
    expect(INTERACTION_KIND_LABELS.merge).toEqual({
      key: "crm.entity360.activity.kind.merge",
      fallback: "Merged",
    });
  });

  /**
   * The two deliberate wording changes (AC 7): the only writer of these rows,
   * `link_reference_to_shidduch()`, always writes `target_type = 'reference'`
   * with `metadata = {shidduchim_id}` — a reference_link joins a reference to
   * a shidduch, never directly to a single. `ShidduchTimeline`'s old "Linked
   * to a reference" labelled a row no code path produces, and
   * `ReferenceTimeline`'s old "Linked to a single" was factually wrong.
   */
  it("link_created reads 'Linked to a shidduch', not the old 'Linked to a reference' / 'Linked to a single'", () => {
    expect(INTERACTION_KIND_LABELS.link_created).toEqual({
      key: "crm.entity360.activity.kind.link_created",
      fallback: "Linked to a shidduch",
    });
  });

  it("link_removed reads 'Unlinked from a shidduch', not the old 'Unlinked from a reference' / 'Unlinked from a single'", () => {
    expect(INTERACTION_KIND_LABELS.link_removed).toEqual({
      key: "crm.entity360.activity.kind.link_removed",
      fallback: "Unlinked from a shidduch",
    });
  });
});

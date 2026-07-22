import { describe, expect, it } from "vitest";
import type { ConversationLogEntry, ReferenceLinkSummary } from "../types";
import {
  CALL_STATUS_DESCRIPTORS,
  getCallStatusDescriptor,
  sortConversationLog,
  summarizeCallProgress,
} from "./callStatus";

describe("getCallStatusDescriptor", () => {
  it("returns the descriptor matching the status", () => {
    // Arrange / Act
    const descriptor = getCallStatusDescriptor("answered");

    // Assert
    expect(descriptor.id).toBe("answered");
    expect(descriptor.isContacted).toBe(true);
  });

  it("distinguishes who owes the next call", () => {
    // Arrange / Act
    const weOweThem = getCallStatusDescriptor("call_back");
    const theyOweUs = getCallStatusDescriptor("they_will_call_back");

    // Assert
    expect(weOweThem.needsFollowUp).toBe(true);
    expect(theyOweUs.needsFollowUp).toBe(false);
  });

  it("falls back to not started when the status is missing", () => {
    // Arrange / Act
    const descriptor = getCallStatusDescriptor(null);

    // Assert
    expect(descriptor.id).toBe("not_started");
  });

  it("falls back to not started for an unrecognised status", () => {
    // Arrange / Act
    const descriptor = getCallStatusDescriptor("something_else");

    // Assert
    expect(descriptor.id).toBe("not_started");
  });

  it("covers every declared status exactly once", () => {
    // Arrange
    const ids = CALL_STATUS_DESCRIPTORS.map((descriptor) => descriptor.id);

    // Act
    const unique = new Set(ids);

    // Assert
    expect(unique.size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });
});

describe("summarizeCallProgress", () => {
  it("counts only statuses that mean the conversation happened", () => {
    // Arrange
    const links = [
      { call_status: "answered" },
      { call_status: "they_will_call_back" },
      { call_status: "no_answer" },
      { call_status: null },
    ];

    // Act
    const progress = summarizeCallProgress(links);

    // Assert
    expect(progress).toEqual({ contacted: 2, total: 4, outstanding: 2 });
  });

  it("handles an empty set without dividing by zero", () => {
    // Arrange / Act
    const progress = summarizeCallProgress([]);

    // Assert
    expect(progress).toEqual({ contacted: 0, total: 0, outstanding: 0 });
  });
});

describe("sortConversationLog", () => {
  it("returns entries newest first", () => {
    // Arrange
    const log: ConversationLogEntry[] = [
      { at: "2026-01-01T10:00:00Z", source: "manual", text: "first" },
      { at: "2026-03-01T10:00:00Z", source: "manual", text: "third" },
      { at: "2026-02-01T10:00:00Z", source: "assistant", text: "second" },
    ];

    // Act
    const sorted = sortConversationLog(log);

    // Assert
    expect(sorted.map((entry) => entry.text)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("does not mutate the stored log", () => {
    // Arrange
    const log: ConversationLogEntry[] = [
      { at: "2026-01-01T10:00:00Z", source: "manual", text: "first" },
      { at: "2026-03-01T10:00:00Z", source: "manual", text: "third" },
    ];
    const before = [...log];

    // Act
    sortConversationLog(log);

    // Assert
    expect(log).toEqual(before);
  });

  it("returns an empty array when there is no log yet", () => {
    // Arrange / Act / Assert
    expect(sortConversationLog(null)).toEqual([]);
    expect(sortConversationLog(undefined)).toEqual([]);
  });
});

describe("call progress against real link records", () => {
  it("treats a link with no call yet as outstanding", () => {
    // Arrange
    const links = [
      { id: 1, call_status: "not_started" },
      { id: 2, call_status: "answered" },
    ] as unknown as ReferenceLinkSummary[];

    // Act
    const progress = summarizeCallProgress(links);

    // Assert
    expect(progress.contacted).toBe(1);
    expect(progress.outstanding).toBe(1);
  });
});

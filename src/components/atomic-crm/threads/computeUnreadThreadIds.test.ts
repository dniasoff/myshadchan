import { describe, expect, it } from "vitest";

import type { Message, Thread, ThreadParticipant } from "../types";
import { computeUnreadThreadIds } from "./computeUnreadThreadIds";

/**
 * Story 7.5 (AC-1) — the derived-unread predicate in isolation, without a
 * render. The integration wiring (this function actually reaching
 * ThreadList's rendered indicator) is `ThreadList.test.tsx`'s job.
 */

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 1,
  account_id: 1,
  connection_id: null,
  subject_type: "relationship",
  subject_id: null,
  visibility: "open",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildParticipant = (
  overrides: Partial<ThreadParticipant> = {},
): ThreadParticipant => ({
  id: 1,
  account_id: 1,
  connection_id: null,
  thread_id: 1,
  member_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  account_id: 1,
  connection_id: null,
  thread_id: 1,
  sender_member_id: null,
  body: "hi",
  created_at: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("computeUnreadThreadIds", () => {
  it("marks a thread unread when the caller has no participation row at all (never joined, or never fetched yet)", () => {
    // Arrange
    const threads = [buildThread({ id: 1 })];
    const messages = [buildMessage({ thread_id: 1 })];

    // Act
    const unread = computeUnreadThreadIds(threads, [], messages);

    // Assert
    expect(unread.has(1)).toBe(true);
  });

  it("marks a thread unread when last_read_at is null (never opened)", () => {
    // Arrange
    const threads = [buildThread({ id: 1 })];
    const participation = [
      buildParticipant({ thread_id: 1, last_read_at: null }),
    ];
    const messages = [buildMessage({ thread_id: 1 })];

    // Act
    const unread = computeUnreadThreadIds(threads, participation, messages);

    // Assert
    expect(unread.has(1)).toBe(true);
  });

  it("marks a thread unread when a message postdates last_read_at", () => {
    // Arrange
    const threads = [buildThread({ id: 1 })];
    const participation = [
      buildParticipant({ thread_id: 1, last_read_at: "2026-01-01T12:00:00Z" }),
    ];
    const messages = [
      buildMessage({ thread_id: 1, created_at: "2026-01-02T00:00:00Z" }),
    ];

    // Act
    const unread = computeUnreadThreadIds(threads, participation, messages);

    // Assert
    expect(unread.has(1)).toBe(true);
  });

  it("does not mark a thread unread when last_read_at is after every message", () => {
    // Arrange
    const threads = [buildThread({ id: 1 })];
    const participation = [
      buildParticipant({ thread_id: 1, last_read_at: "2026-01-03T00:00:00Z" }),
    ];
    const messages = [
      buildMessage({ thread_id: 1, created_at: "2026-01-02T00:00:00Z" }),
    ];

    // Act
    const unread = computeUnreadThreadIds(threads, participation, messages);

    // Assert
    expect(unread.has(1)).toBe(false);
  });

  it("does not mark a thread with no messages at all as unread", () => {
    // Arrange
    const threads = [buildThread({ id: 1 })];

    // Act
    const unread = computeUnreadThreadIds(threads, [], []);

    // Assert
    expect(unread.has(1)).toBe(false);
  });

  it("evaluates each thread independently — one unread, one read, in the same list", () => {
    // Arrange
    const threads = [buildThread({ id: 1 }), buildThread({ id: 2 })];
    const participation = [
      buildParticipant({ id: 1, thread_id: 1, last_read_at: null }),
      buildParticipant({
        id: 2,
        thread_id: 2,
        last_read_at: "2026-01-03T00:00:00Z",
      }),
    ];
    const messages = [
      buildMessage({ id: 1, thread_id: 1, created_at: "2026-01-02T00:00:00Z" }),
      buildMessage({ id: 2, thread_id: 2, created_at: "2026-01-02T00:00:00Z" }),
    ];

    // Act
    const unread = computeUnreadThreadIds(threads, participation, messages);

    // Assert
    expect(unread.has(1)).toBe(true);
    expect(unread.has(2)).toBe(false);
  });
});

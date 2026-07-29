import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveStack } from "./stack-env.mjs";
import {
  currentOwner,
  leaseDecision,
  leaseFile,
  readLease,
  releaseLease,
  writeLease,
} from "./stack-lease.mjs";

// A stack id nothing else in this repo uses by default, so the round-trip test
// cannot disturb a stack an agent is actually running.
const SCRATCH_STACK = resolveStack(9);

afterEach(() => {
  releaseLease(SCRATCH_STACK);
});

describe("the lease decision", () => {
  const owner = "agent-a";
  const theirs = { owner: "agent-b", acquiredAt: "2026-07-24T00:00:00.000Z" };
  const mine = { owner, acquiredAt: "2026-07-24T00:00:00.000Z" };

  it("grants a stack nobody is running", () => {
    // Arrange / Act
    const decision = leaseDecision({ lease: null, isUp: false, owner });

    // Assert
    expect(decision).toEqual({ granted: true, reason: "free" });
  });

  it("grants a stack whose lease is left over from a dead run", () => {
    // Arrange / Act — a killed run never releases, so a lease with nothing
    // running must not lock an id out forever.
    const decision = leaseDecision({ lease: theirs, isUp: false, owner });

    // Assert
    expect(decision).toEqual({ granted: true, reason: "stale-lease" });
  });

  it("grants your own running stack so a fresh database is still one command", () => {
    // Arrange / Act — `make start-supabase-e2e` means "rebuild my stack"; it is
    // also what playwright.config.ts's webServer runs.
    const decision = leaseDecision({ lease: mine, isUp: true, owner });

    // Assert
    expect(decision).toEqual({ granted: true, reason: "already-yours" });
  });

  it("refuses a running stack held by someone else, naming the holder", () => {
    // Arrange / Act — this is the destructive case: the recipe would run
    // `supabase stop --no-backup` on their database and exit 0.
    const decision = leaseDecision({ lease: theirs, isUp: true, owner });

    // Assert
    expect(decision).toEqual({
      granted: false,
      reason: "held",
      holder: "agent-b",
    });
  });

  it("refuses a running stack with no lease rather than assuming it is free", () => {
    // Arrange / Act — something is listening on those ports; who started it is
    // unknown, which is a reason to stop, not a reason to proceed.
    const decision = leaseDecision({ lease: null, isUp: true, owner });

    // Assert
    expect(decision).toEqual({ granted: false, reason: "running-unleased" });
  });

  it("lets STACK_TAKEOVER override every refusal", () => {
    // Arrange / Act / Assert
    for (const lease of [null, theirs]) {
      expect(
        leaseDecision({ lease, isUp: true, owner, takeover: true }),
      ).toEqual({ granted: true, reason: "takeover" });
    }
  });
});

describe("owner identity", () => {
  it("prefers STACK_OWNER, which is what a wave manifest assigns", () => {
    // Arrange / Act / Assert
    expect(
      currentOwner({
        STACK_OWNER: "wave-3/story-2",
        CLAUDE_CODE_SESSION_ID: "s",
      }),
    ).toBe("wave-3/story-2");
  });

  it("falls back to the Claude session, then to user@host", () => {
    // Arrange / Act / Assert
    expect(currentOwner({ CLAUDE_CODE_SESSION_ID: "abc" })).toBe("claude:abc");
    expect(currentOwner({})).toBe(`${os.userInfo().username}@${os.hostname()}`);
  });

  it("treats a blank STACK_OWNER as unset rather than as an owner named ''", () => {
    // Arrange / Act / Assert
    expect(
      currentOwner({ STACK_OWNER: "   ", CLAUDE_CODE_SESSION_ID: "abc" }),
    ).toBe("claude:abc");
  });
});

describe("the lease file", () => {
  it("round-trips an owner and disappears on release", () => {
    // Arrange
    writeLease(SCRATCH_STACK, "agent-a");

    // Act
    const lease = readLease(SCRATCH_STACK);
    releaseLease(SCRATCH_STACK);

    // Assert
    expect(lease.owner).toBe("agent-a");
    expect(readLease(SCRATCH_STACK)).toBeNull();
  });

  it("reads a corrupt lease as absent instead of throwing", () => {
    // Arrange — a half-written file must not wedge every later acquire.
    const file = leaseFile(SCRATCH_STACK);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");

    // Act / Assert
    expect(readLease(SCRATCH_STACK)).toBeNull();
  });

  it("releases an id that was never leased without error", () => {
    // Arrange / Act / Assert — `make stop-stacks` calls release for all ten.
    expect(() => releaseLease(SCRATCH_STACK)).not.toThrow();
  });
});

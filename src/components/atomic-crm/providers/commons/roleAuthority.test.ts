import { describe, expect, it } from "vitest";

import type { MemberRole, MyContext } from "../../types";
import {
  canManageMembers,
  pickActiveContext,
  pickActiveRole,
} from "./roleAuthority";

/**
 * Story 3.4 — the additions this story makes to the established
 * `roleAuthority.ts` home: the active-context selector (`pickActiveContext`
 * / `pickActiveRole`) and the members-management predicate
 * (`canManageMembers`). `invitableRoles` / `isInviteCapableRole` /
 * `ROLE_AUTHORITY` predate this story and are already covered by
 * `settings/InvitesSection.test.tsx`.
 */

const buildContext = (overrides: Partial<MyContext> = {}): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
  ...overrides,
});

describe("pickActiveContext", () => {
  it("returns the row whose is_active is true", () => {
    // Arrange
    const active = buildContext({ account_id: 2, is_active: true });
    const contexts = [
      buildContext({ account_id: 1, is_active: false }),
      active,
    ];

    // Act / Assert
    expect(pickActiveContext(contexts)).toEqual(active);
  });

  it("returns undefined when no row is active", () => {
    // Arrange
    const contexts = [buildContext({ is_active: false })];

    // Act / Assert
    expect(pickActiveContext(contexts)).toBeUndefined();
  });

  it("returns undefined for an empty array, and never borrows the first row", () => {
    expect(pickActiveContext([])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(pickActiveContext(undefined)).toBeUndefined();
  });
});

describe("pickActiveRole", () => {
  it("returns the active context's role", () => {
    // Arrange
    const contexts = [
      buildContext({ account_id: 1, role: "helper", is_active: false }),
      buildContext({ account_id: 2, role: "shadchan", is_active: true }),
    ];

    // Act / Assert
    expect(pickActiveRole(contexts)).toBe("shadchan");
  });

  it("returns undefined when no context is active (fails closed, no ?? contexts[0] fallback)", () => {
    // Arrange
    const contexts = [buildContext({ is_active: false })];

    // Act / Assert
    expect(pickActiveRole(contexts)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(pickActiveRole(undefined)).toBeUndefined();
  });
});

describe("canManageMembers", () => {
  const ALL_MEMBER_ROLES_RECORD: Record<MemberRole, true> = {
    parent_admin: true,
    helper: true,
    self_manager: true,
    shadchan: true,
    single: true,
  };
  const ALL_MEMBER_ROLES = Object.keys(ALL_MEMBER_ROLES_RECORD) as MemberRole[];

  it.each(["parent_admin", "self_manager", "shadchan"] as MemberRole[])(
    "allows %s",
    (role) => {
      expect(canManageMembers(role)).toBe(true);
    },
  );

  it.each(["helper", "single"] as MemberRole[])("denies %s", (role) => {
    expect(canManageMembers(role)).toBe(false);
  });

  it("covers every MemberRole (no role silently unhandled)", () => {
    for (const role of ALL_MEMBER_ROLES) {
      expect(typeof canManageMembers(role)).toBe("boolean");
    }
  });
});

import { describe, expect, it } from "vitest";

import type { MemberRole } from "../../types";
import { canAccess } from "./canAccess";

/**
 * Story 3.4 AC 8 — the three rules, table-driven: `role === undefined`
 * fails closed for every resource; `resource === "members"` is gated on
 * `canManageMembers`; every other resource is open to any resolved role.
 */

const ROLES: MemberRole[] = [
  "parent_admin",
  "helper",
  "self_manager",
  "shadchan",
  "single",
];

const OWNING_ROLES: MemberRole[] = ["parent_admin", "self_manager", "shadchan"];
const NON_OWNING_ROLES: MemberRole[] = ["helper", "single"];

describe("canAccess — the members resource", () => {
  it.each(OWNING_ROLES)("allows %s", (role) => {
    expect(canAccess(role, { resource: "members", action: "list" })).toBe(true);
  });

  it.each(NON_OWNING_ROLES)("denies %s", (role) => {
    expect(canAccess(role, { resource: "members", action: "list" })).toBe(
      false,
    );
  });

  it("denies an unresolved role", () => {
    expect(canAccess(undefined, { resource: "members", action: "list" })).toBe(
      false,
    );
  });
});

describe("canAccess — every other resource", () => {
  it.each(ROLES)("allows %s on shidduchim", (role) => {
    expect(canAccess(role, { resource: "shidduchim", action: "list" })).toBe(
      true,
    );
  });

  it("denies an unresolved role", () => {
    expect(
      canAccess(undefined, { resource: "shidduchim", action: "list" }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { MemberRole } from "../types";
import { hasVisibility } from "./visibility";

/**
 * AC 2 — the whole truth table, including the two edge rows, driven by a
 * locally-declared, exhaustiveness-guarded role tuple (AC 1(a)'s pattern):
 * if `MemberRole` ever grows a sixth value, the literal below fails to
 * typecheck until this file's sweep is updated too, so a new role cannot be
 * silently skipped.
 */
const ALL_MEMBER_ROLES_RECORD: Record<MemberRole, true> = {
  parent_admin: true,
  helper: true,
  self_manager: true,
  shadchan: true,
  single: true,
};
const ALL_MEMBER_ROLES = Object.keys(ALL_MEMBER_ROLES_RECORD) as MemberRole[];

describe("hasVisibility — visibleTo undefined (edge row 1)", () => {
  it.each([...ALL_MEMBER_ROLES, undefined])(
    "returns true for role %s when visibleTo is undefined",
    (role) => {
      expect(hasVisibility(undefined, role)).toBe(true);
    },
  );
});

describe("hasVisibility — visibleTo is an empty allow-list (edge row 2)", () => {
  it.each([...ALL_MEMBER_ROLES, undefined])(
    "returns false for role %s when visibleTo is []",
    (role) => {
      expect(hasVisibility([], role)).toBe(false);
    },
  );
});

describe("hasVisibility — a single-entry allow-list", () => {
  it.each(ALL_MEMBER_ROLES)(
    "returns true when %s is on its own allow-list",
    (role) => {
      expect(hasVisibility([role], role)).toBe(true);
    },
  );

  it.each(
    ALL_MEMBER_ROLES.flatMap((allowed) =>
      ALL_MEMBER_ROLES.filter((role) => role !== allowed).map((role) => ({
        allowed,
        role,
      })),
    ),
  )(
    "returns false for role $role when only $allowed is allowed",
    ({ allowed, role }) => {
      expect(hasVisibility([allowed], role)).toBe(false);
    },
  );

  it.each(ALL_MEMBER_ROLES)(
    "returns false (fails closed) when role is undefined and %s is on the allow-list",
    (allowed) => {
      expect(hasVisibility([allowed], undefined)).toBe(false);
    },
  );
});

describe("hasVisibility — a multi-entry allow-list", () => {
  it("returns true for a role present in the list", () => {
    expect(hasVisibility(["helper", "single"], "single")).toBe(true);
  });

  it("returns false for a role absent from the list", () => {
    expect(hasVisibility(["helper", "single"], "parent_admin")).toBe(false);
  });
});

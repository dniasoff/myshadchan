import { describe, expect, it } from "vitest";

import type { MemberRole } from "../../types";
import { canAccess } from "./canAccess";

/**
 * Role decisions stay aligned with the active-context database policies:
 * unresolved roles fail closed, members are manager-only, and a single role
 * is limited to its self-managed surfaces.
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

describe("canAccess — self-managed single surfaces", () => {
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

  it.each(["singles", "shidduchim", "single_preferences", "single_notes"])(
    "allows a single to use %s",
    (resource) => {
      expect(canAccess("single", { resource, action: "list" })).toBe(true);
    },
  );

  it("keeps candid and household-only surfaces out of the single role", () => {
    expect(
      canAccess("single", { resource: "references", action: "list" }),
    ).toBe(false);
    expect(
      canAccess("single", { resource: "inbox_items", action: "list" }),
    ).toBe(false);
  });

  it("allows a single to browse the shadchan book", () => {
    expect(
      canAccess("single", { resource: "shadchanim", action: "list" }),
    ).toBe(true);
  });
});

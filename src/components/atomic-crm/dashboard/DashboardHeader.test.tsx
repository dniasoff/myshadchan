import { describe, expect, it } from "vitest";

import { canViewChildDocuments } from "./DashboardHeader";

describe("DashboardHeader document visibility", () => {
  it.each(["parent_admin", "self_manager", "helper", "shadchan"] as const)(
    "allows the %s role to open Documents",
    (role) => {
      expect(canViewChildDocuments(role, false)).toBe(true);
    },
  );

  it("hides Documents from the single role and while the role is pending", () => {
    expect(canViewChildDocuments("single", false)).toBe(false);
    expect(canViewChildDocuments("parent_admin", true)).toBe(false);
    expect(canViewChildDocuments(undefined, false)).toBe(false);
  });
});

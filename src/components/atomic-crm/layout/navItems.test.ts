import { PRIMARY_NAV } from "./navItems";

describe("PRIMARY_NAV", () => {
  it("contains exactly the 7 foundation nav items in order", () => {
    expect(PRIMARY_NAV.map((item) => item.to)).toEqual([
      "/",
      "/inbox_items",
      "/shidduchim",
      "/shadchanim",
      "/tasks",
      "/reminders",
      "/settings",
    ]);
  });

  it("gives every item a non-empty label default and a valid icon", () => {
    for (const item of PRIMARY_NAV) {
      expect(item.labelDefault.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });

  it("labels the shidduchim destination 'Shidduchim', not 'Pipeline'", () => {
    const shidduchim = PRIMARY_NAV.find((item) => item.to === "/shidduchim");
    expect(shidduchim?.labelDefault).toBe("Shidduchim");
    expect(shidduchim?.labelKey).toBe("crm.navigation.shidduchim");
  });

  it("never links to /references — RULING 7, no browse surface for a scoped entity", () => {
    // An absence test that survives a future re-add, unlike the ordered
    // array assertion above (which would only fail if /references replaced
    // one of the seven existing slots, not if it were appended as an
    // eighth).
    for (const item of PRIMARY_NAV) {
      expect(item.to).not.toBe("/references");
      expect(item.to.startsWith("/references/")).toBe(false);
    }
  });
});

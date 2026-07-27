import { PRIMARY_NAV } from "./navItems";

describe("PRIMARY_NAV", () => {
  it("contains exactly the 7 foundation nav items in order", () => {
    expect(PRIMARY_NAV.map((item) => item.to)).toEqual([
      "/",
      "/shidduchim",
      "/inbox_items",
      "/shadchanim",
      "/references",
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
});

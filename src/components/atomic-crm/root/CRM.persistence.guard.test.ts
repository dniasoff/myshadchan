import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./CRM.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("CRM mobile persistence wiring", () => {
  it("uses the shared private-data persistence policy", () => {
    const source = sources["./CRM.tsx"];

    expect(source).toContain('from "./queryPersistence"');
    expect(source).toContain("...mobilePersistOptions");
    expect(source).toContain("persister: asyncStoragePersister");
  });
});

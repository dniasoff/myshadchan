import { describe, expect, it } from "vitest";
import { buildCallScript } from "./callScript";

describe("buildCallScript", () => {
  it("relationship-specific set comes first and universal last", () => {
    const script = buildCallScript("seminary teacher");
    expect(script.length).toBeGreaterThan(3);
    // First questions should be from the teacher set
    expect(script[0].question).toContain("difficult");
    expect(script[1].question).toContain("peers");
    expect(script[2].question).toContain("responsibility");
    // Last 3 should be universal
    expect(script[script.length - 3].question).toBe(
      "How long have you known them, and in what setting?",
    );
    expect(script[script.length - 2].question).toBe(
      "How would you describe them to someone who has never met them?",
    );
    expect(script[script.length - 1].question).toBe(
      "Is there anything you think we should know that we have not asked about?",
    );
  });

  it("blank/unrecognised relationship yields exactly the three universal steps", () => {
    const script = buildCallScript("");
    expect(script.length).toBe(3);
    expect(script[0].question).toBe(
      "How long have you known them, and in what setting?",
    );
    expect(script[1].question).toBe(
      "How would you describe them to someone who has never met them?",
    );
    expect(script[2].question).toBe(
      "Is there anything you think we should know that we have not asked about?",
    );
  });

  it("CHAVRUSA relationship yields friend set + universal", () => {
    const script = buildCallScript("CHAVRUSA");
    expect(script.length).toBeGreaterThan(3);
    expect(script[0].question).toContain("inconvenient");
    expect(script[script.length - 1].question).toContain("not asked about");
  });

  it("unrecognised relationship (dog walker) falls back to universal only", () => {
    const script = buildCallScript("dog walker");
    expect(script.length).toBe(3);
    expect(script[0].question).toBe(
      "How long have you known them, and in what setting?",
    );
    expect(script[script.length - 1].question).toContain("not asked about");
  });

  it("neighbour relationship yields neighbour set + universal", () => {
    const script = buildCallScript("next-door neighbour");
    expect(script.length).toBeGreaterThan(3);
    expect(script[0].question).toContain("home like");
    expect(script[script.length - 1].question).toContain("not asked about");
  });

  it("ids are unique within a script", () => {
    const script = buildCallScript("seminary teacher");
    const ids = script.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("ids follow the deterministic pattern ${set?.id ?? 'universal'}.${index}", () => {
    const script = buildCallScript("seminary teacher");
    expect(script[0].id).toBe("teacher.0");
    expect(script[1].id).toBe("teacher.1");

    const universalScript = buildCallScript("");
    expect(universalScript[0].id).toBe("universal.0");
    expect(universalScript[1].id).toBe("universal.1");
  });

  it("function is referentially stable for the same input", () => {
    const script1 = buildCallScript("seminary teacher");
    const script2 = buildCallScript("seminary teacher");
    expect(script1).toEqual(script2);
  });
});

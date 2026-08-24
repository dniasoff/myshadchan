import { describe, expect, it } from "vitest";
import { englishCrmMessages } from "./englishCrmMessages";

/**
 * The register guard for in-app copy, and the reason it exists.
 *
 * `landing/LandingPage.test.tsx` has had a banned-phrase test since the
 * landing page was written, and the landing page is consequently the one
 * surface that never drifted: it still reads "A record of the shidduch
 * process", "Records are held per family". Everything behind the login had
 * no such guard, and drifted — "a calm, private place", "one calm book",
 * "your calm home base", "you're on top of it", "Enjoy exploring!". Those
 * were removed by hand; without a guard the same words come back the next
 * time someone writes an empty state, because nothing says not to.
 *
 * This is deliberately NOT the landing page's list. "pipeline" and "CRM" are
 * banned there and are ordinary domain vocabulary here ("shidduchim
 * pipeline"). What is banned here is narrower: words that describe how the
 * product is supposed to FEEL, and phrases that tell the reader how they are
 * doing. An empty list is a fact; whether the reader is on top of it is not
 * something the application knows.
 */
const BANNED = [
  "calm",
  "effortless",
  "seamless",
  "revolutionize",
  "revolutionise",
  "peace of mind",
  "you're on top of it",
  "you are on top of it",
  "nothing slips",
  "nothing gets lost",
  "enjoy exploring",
  "whenever you're ready",
  "as much or as little",
];

const collect = (
  node: unknown,
  path: string,
  out: Array<[string, string]>,
): void => {
  if (typeof node === "string") {
    out.push([path, node]);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      collect(v, path ? `${path}.${k}` : k, out);
    }
  }
};

describe("englishCrmMessages — register", () => {
  it("states facts rather than describing how the product feels", () => {
    // Arrange
    const entries: Array<[string, string]> = [];
    collect(englishCrmMessages, "", entries);

    // Act
    const offenders = entries.filter(([, value]) =>
      BANNED.some((phrase) => value.toLowerCase().includes(phrase)),
    );

    // Assert
    expect(
      offenders.map(([key, value]) => `${key}: ${value}`),
      "in-app copy drifted back into atmospheric register",
    ).toEqual([]);
  });

  it("covers the whole catalogue, so a passing result means something", () => {
    // Arrange / Act: the guard above is only evidence if it actually walked
    // the catalogue — an empty or shallow walk would pass identically.
    const entries: Array<[string, string]> = [];
    collect(englishCrmMessages, "", entries);

    // Assert
    expect(entries.length).toBeGreaterThan(500);
    expect(entries.some(([key]) => key.startsWith("crm.legal."))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

// Side-effect imports — each module registers its descriptor at module
// scope, mirroring the real boot sequence: `root/routeManifest.ts` imports
// every resource `index.ts`, and each `<entity>/index.ts` imports
// `./entityDescriptor` as its first line.
import "../shidduchim/entityDescriptor";
import "../singles/entityDescriptor";
import "../shadchanim/entityDescriptor";
import "../references/entityDescriptor";

import { getEntityDescriptor } from "./registry";
import type { TabKey } from "./tabKeys";

/**
 * AC 2 — pins the four Epic 3 stub descriptors' paths and `pendingTabs`
 * rows, transcribed verbatim from contract §3 rule 5 / this story's own
 * table. Deleting any one `registerEntityDescriptor` call above, or
 * changing one path or one `pendingTabs` row, turns this test red.
 *
 * This test IS MEANT to fail the day Epic 5 flips one of these entities'
 * route shape (`/{r}/{id}/show` -> `/{r}/{id}`) or moves a tab from
 * `pendingTabs` into `tabs` without updating the pin here in the same diff.
 * Re-read `root/routeManifest.ts:92-100` and the failing entity's
 * `<entity>/index.ts` when that happens — the pins are literal strings by
 * design (`ResourceEntry.definition` holds components, not path templates,
 * so there is nothing else to derive them from).
 */

interface StubCase {
  name: "shidduchim" | "singles" | "shadchanim" | "references";
  pendingTabs: TabKey[];
}

const CASES: StubCase[] = [
  {
    name: "shidduchim",
    pendingTabs: [
      "overview",
      "resume",
      "photo",
      "medical",
      "files",
      "diligence",
      "external-links",
      "notes",
      "tasks",
      "activity",
    ],
  },
  {
    name: "singles",
    pendingTabs: [
      "overview",
      "resume",
      "photo",
      "files",
      "shidduchim",
      "notes",
      "tasks",
      "activity",
    ],
  },
  {
    name: "shadchanim",
    pendingTabs: ["overview", "shidduchim", "notes", "tasks", "activity"],
  },
  {
    name: "references",
    pendingTabs: [
      "overview",
      "conversations",
      "shidduchim",
      "notes",
      "tasks",
      "activity",
      "assistant",
    ],
  },
];

describe.each(CASES)(
  "$name stub descriptor (AC 2)",
  ({ name, pendingTabs }) => {
    it("is registered with the pinned buildRecordPath, empty tabs, and full pendingTabs", () => {
      // Act
      const descriptor = getEntityDescriptor(name);

      // Assert
      expect(descriptor).toBeDefined();
      expect(descriptor?.name).toBe(name);
      expect(descriptor?.label.length).toBeGreaterThan(0);
      expect(descriptor?.buildRecordPath(1)).toBe(`/${name}/1/show`);
      expect(descriptor?.tabs).toEqual([]);
      expect(descriptor?.pendingTabs).toEqual(pendingTabs);
    });
  },
);

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
 * Pins each of the four AD-24 entities' descriptor shape: its
 * `buildRecordPath`, its `tabs` keys (in order) and its `pendingTabs` row.
 * Three of the four (`singles`, `shadchanim`, `references`) are still Story
 * 3.9's unmigrated stub — `/{name}/1/show`, empty `tabs`, a full
 * `pendingTabs`. `shidduchim` is Story 5.1's real descriptor (Story 5.3
 * moved `resume`, 5.4 moved `photo`, 5.5 moved `medical` — each from
 * `pendingTabs` into `tabs`, in canonical position): the bare AD-24 path,
 * its eight real `tabs`, and the two keys still pending.
 *
 * `buildRecordPath` and `tabs` are per-case `StubCase` fields, not a shared
 * template string / shared literal (Story 5.1's reshape of this file):
 * before 5.1, all four cases shared one `it(...)` body asserting
 * `buildRecordPath(1) === "/${name}/1/show"` and `tabs toEqual []` for
 * every case — an assertion that cannot express "one of four now differs".
 * `pendingTabs` was already a per-case field and is unchanged in shape.
 *
 * Deleting a `registerEntityDescriptor` call above, or changing any one
 * field below, turns this test red — re-read `root/routeManifest.ts` and
 * the failing entity's `<entity>/index.ts` when that happens.
 */

interface StubCase {
  name: "shidduchim" | "singles" | "shadchanim" | "references";
  buildRecordPath: string;
  tabs: TabKey[];
  pendingTabs: TabKey[];
}

const CASES: StubCase[] = [
  {
    name: "shidduchim",
    buildRecordPath: "/shidduchim/1",
    tabs: [
      "overview",
      "resume",
      "photo",
      "medical",
      "diligence",
      "notes",
      "tasks",
      "activity",
    ],
    pendingTabs: ["files", "external-links"],
  },
  {
    name: "singles",
    buildRecordPath: "/singles/1/show",
    tabs: [],
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
    buildRecordPath: "/shadchanim/1/show",
    tabs: [],
    pendingTabs: ["overview", "shidduchim", "notes", "tasks", "activity"],
  },
  {
    name: "references",
    buildRecordPath: "/references/1/show",
    tabs: [],
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
  "$name descriptor (AC 2 / Story 5.1 Task 2)",
  ({ name, buildRecordPath, tabs, pendingTabs }) => {
    it("is registered with the pinned buildRecordPath, tabs, and pendingTabs", () => {
      // Act
      const descriptor = getEntityDescriptor(name);

      // Assert
      expect(descriptor).toBeDefined();
      expect(descriptor?.name).toBe(name);
      expect(descriptor?.label.length).toBeGreaterThan(0);
      expect(descriptor?.buildRecordPath(1)).toBe(buildRecordPath);
      expect(descriptor?.tabs?.map((tab) => tab.key) ?? []).toEqual(tabs);
      expect(descriptor?.pendingTabs).toEqual(pendingTabs);
    });
  },
);

import { describe, expect, it } from "vitest";

/**
 * UX-DR3 — "records live at URLs, not in modals" (AD-24). This scans the
 * atomic-crm source at build time (Vite inlines the files as raw strings,
 * the same `?raw` shape as `references/entitlementGate.guard.test.ts`) and
 * asserts that the only files in the five entity/record directories still
 * importing `@/components/ui/dialog` are the small, named exemptions below.
 * It fails loudly if a new primary-record surface starts hiding behind a
 * `<Dialog>` instead of getting a page.
 *
 * Scope is deliberately narrow: `inbox/`, `settings/`, `misc/` and `layout/`
 * are outside it. Their dialogs are actions and confirmations, not a
 * record's own screen, and widening the scan to them would turn the
 * allowlist into a list of every dialog in the app — no longer a UX-DR3
 * statement (Story 3.13 Dev Notes, "The `?raw` guard, precisely").
 */

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const basename = (path: string): string => path.split("/").pop() ?? path;

// The five entity/record directories UX-DR3 actually governs.
const RECORD_SURFACE_DIRECTORIES = [
  "shidduchim",
  "singles",
  "shadchanim",
  "references",
  "tasks",
];

const isInScannedDirectory = (path: string): boolean =>
  RECORD_SURFACE_DIRECTORIES.some((dir) => path.includes(`/${dir}/`));

const importsDialog = (content: string): boolean =>
  /from\s+["']@\/components\/ui\/dialog["']/.test(content);

// Named, permanent or story-scoped exemptions — see each comment for why.
// `ShidduchShow.tsx` (the routed 360 dialog) and `ShidduchShowHeader.tsx`
// (which imported `DialogTitle` only because it rendered inside the above)
// were here until Story 5.1: the dialog is deleted and the header no longer
// imports `@/components/ui/dialog` at all.
const ALLOWED = new Set([
  "ReferenceMergeButton.tsx", // a merge confirmation, not a record surface — permanent
  "TaskEdit.tsx", // AC 4's recorded exemption — see the doc comment on the file itself
  "SingleGrantManagement.tsx", // Story 13.1's grant lifecycle UI; it is an action dialog (propose / accept / sever / re-grant), not a record surface, so UX-DR3 does not govern it
]);

const dialogWrappedFiles = Object.entries(sources)
  .filter(
    ([path, content]) =>
      // Ignore test/guard files (this guard itself references dialog names in prose).
      !path.includes(".test.") &&
      !path.includes(".guard.") &&
      isInScannedDirectory(path) &&
      importsDialog(content),
  )
  .map(([path]) => path);

describe("dialog-wrapped record surfaces stay pinned (UX-DR3)", () => {
  it("keeps the dialog-wrapped file set a subset of the recorded exemptions", () => {
    // Arrange
    const offenders = dialogWrappedFiles.filter(
      (path) => !ALLOWED.has(basename(path)),
    );

    // Assert
    expect(
      offenders,
      `Unexpected dialog-wrapped record surface(s): ${offenders.join(", ")}. ` +
        `Primary records live at URLs, not in modals (UX-DR3) — either convert ` +
        `the surface to a page or add a named, commented exemption above.`,
    ).toEqual([]);
  });

  it("confirms the scan does find TaskEdit.tsx (guard sanity check)", () => {
    // Arrange / Assert — if this ever fails, the glob or regex broke and the
    // subset assertion above would be vacuously green.
    const foundTaskEdit = dialogWrappedFiles.some(
      (path) => basename(path) === "TaskEdit.tsx",
    );
    expect(foundTaskEdit).toBe(true);
  });
});

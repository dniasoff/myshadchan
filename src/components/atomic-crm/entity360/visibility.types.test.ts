import { describe, expect, it } from "vitest";

import type { MemberRole } from "../types";
import type { EntityDescriptor } from "./entityDescriptor";

/**
 * AC 1 — type-level guarantees, compiled but not exercised at runtime:
 *
 * (a) an exhaustiveness record over `MemberRole` — the same tables this
 *     story ships (`visibility.test.ts`'s sweep, `EntityShow.permissions
 *     .test.tsx`'s five-role negative sweep) fail to typecheck if a sixth
 *     role is added and they are not updated in the same diff.
 * (b) `EntityDescriptor` carries no `visibleTo` of its own — the field lives
 *     on `EntityTabDescriptor` only (contract §2 rule 7 / this story's Dev
 *     Notes, "The `epics.md` 'field' half"). A descriptor-level `visibleTo`
 *     would be region-level gating, which this story deliberately does not
 *     add.
 *
 * This is `entity360/roleSource.guard.test.ts`'s companion, not a
 * duplicate: the guard proves the retired name `minVisibility` appears
 * nowhere in `entity360/`'s source; this file proves the CURRENT name,
 * `visibleTo`, is rejected at the wrong location (`EntityDescriptor`, not
 * `EntityTabDescriptor`).
 */
describe("visibility — type-level guarantees (AC 1)", () => {
  it("MemberRole exhaustiveness: a sixth role must update this table in the same diff", () => {
    // Arrange / Act — fails to typecheck the moment `MemberRole` gains a
    // value not listed here.
    const _exhaustive: Record<MemberRole, true> = {
      parent_admin: true,
      helper: true,
      self_manager: true,
      shadchan: true,
      single: true,
    };

    // Assert
    expect(Object.keys(_exhaustive)).toHaveLength(5);
  });

  it("rejects an EntityDescriptor literal carrying its own visibleTo (AC 1b)", () => {
    // Arrange / Act
    const descriptor: EntityDescriptor = {
      name: "fixture-descriptor-visible-to",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
      // @ts-expect-error — visibleTo lives on EntityTabDescriptor only; a
      // descriptor-level visibleTo is out-of-scope region gating (AC 1b).
      visibleTo: [],
    };

    // Assert
    expect(descriptor).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";

import type { EntityDescriptor } from "./entityDescriptor";
import { registerEntityDescriptor } from "./registry";
import { hasAd24RecordShape, redirectToRecord } from "./routeConvention";

/**
 * Pins the two pure predicates Task 1 adds: `hasAd24RecordShape` (AC 3) and
 * `redirectToRecord` (AC 4). `buildCreateRoutes` / `LegacyCreatePathRedirect`
 * need a router to exercise (Task 2's `routeConvention.routes.test.tsx`).
 * Every fixture registers a unique `name` so no test depends on registry
 * state left by another (`.claude/rules/testing.md#Test-isolation`).
 */

const registerStub = (name: string): void => {
  const descriptor: EntityDescriptor = {
    name,
    label: name,
    buildRecordPath: (id) => `/${name}/${id}/show`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

const registerAd24 = (name: string): void => {
  const descriptor: EntityDescriptor = {
    name,
    label: name,
    buildRecordPath: (id) => `/${name}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

describe("hasAd24RecordShape", () => {
  it("is false against a stub descriptor whose buildRecordPath is still /{name}/{id}/show", () => {
    // Arrange
    registerStub("route-convention-stub-fixture");

    // Act / Assert
    expect(hasAd24RecordShape("route-convention-stub-fixture", 1)).toBe(false);
  });

  it("is true against a descriptor already matching AD-24's /{name}/{id} shape", () => {
    // Arrange
    registerAd24("route-convention-ad24-fixture");

    // Act / Assert
    expect(hasAd24RecordShape("route-convention-ad24-fixture", 1)).toBe(true);
  });

  it("is false for a resource with no registered descriptor at all", () => {
    // Act / Assert
    expect(hasAd24RecordShape("route-convention-unregistered-fixture", 1)).toBe(
      false,
    );
  });
});

describe("redirectToRecord", () => {
  it('returns "/" when resource is null', () => {
    // Act / Assert
    expect(redirectToRecord(undefined, 1)).toBe("/");
  });

  it("returns the list path when id is null", () => {
    // Arrange
    registerAd24("route-convention-redirect-list-fixture");

    // Act / Assert
    expect(
      redirectToRecord("route-convention-redirect-list-fixture", undefined),
    ).toBe("/route-convention-redirect-list-fixture");
  });

  it("returns the record path when both resource and id are present", () => {
    // Arrange
    registerAd24("route-convention-redirect-record-fixture");

    // Act / Assert
    expect(
      redirectToRecord("route-convention-redirect-record-fixture", 7),
    ).toBe("/route-convention-redirect-record-fixture/7");
  });
});

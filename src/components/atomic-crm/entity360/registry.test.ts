import { describe, expect, it } from "vitest";

import type { EntityDescriptor } from "./entityDescriptor";
import * as registryModule from "./registry";
import {
  getEntityDescriptor,
  registerEntityDescriptor,
  requireEntityDescriptor,
} from "./registry";

/**
 * Contract §4 / story AC 3. Every test below registers a unique fixture
 * `name` (never reused across tests) so no test depends on registry state
 * left over by another (`.claude/rules/testing.md#Test-isolation`) — the
 * registry's backing `Map` is real, module-scoped state shared across the
 * whole test file.
 */

const buildDescriptor = (name: string): EntityDescriptor => ({
  name,
  buildRecordPath: (id) => `/${name}/${id}`,
  label: name,
});

describe("registry module surface", () => {
  it("exports exactly the three registry functions — the backing Map is not exported", () => {
    // Assert
    expect(Object.keys(registryModule).sort()).toEqual(
      [
        "getEntityDescriptor",
        "registerEntityDescriptor",
        "requireEntityDescriptor",
      ].sort(),
    );
  });
});

describe("registerEntityDescriptor / getEntityDescriptor round trip", () => {
  it("getEntityDescriptor returns the exact same object that was registered", () => {
    // Arrange
    const descriptor = buildDescriptor("registry-round-trip");

    // Act
    registerEntityDescriptor(descriptor);

    // Assert
    expect(getEntityDescriptor("registry-round-trip")).toBe(descriptor);
  });
});

describe("registerEntityDescriptor — duplicate name", () => {
  it("throws when the same name is registered a second time without { replace: true }", () => {
    // Arrange
    registerEntityDescriptor(buildDescriptor("registry-duplicate-throws"));

    // Act / Assert
    expect(() =>
      registerEntityDescriptor(buildDescriptor("registry-duplicate-throws")),
    ).toThrow();
  });

  it("succeeds with { replace: true }, and the subsequent lookup returns the NEW object", () => {
    // Arrange
    const original = buildDescriptor("registry-replace");
    const replacement: EntityDescriptor = {
      ...buildDescriptor("registry-replace"),
      label: "Replacement label",
    };
    registerEntityDescriptor(original);

    // Act
    registerEntityDescriptor(replacement, { replace: true });

    // Assert
    expect(getEntityDescriptor("registry-replace")).toBe(replacement);
    expect(getEntityDescriptor("registry-replace")).not.toBe(original);
  });
});

describe("getEntityDescriptor — unregistered resource", () => {
  it("returns undefined; never throws", () => {
    // Act / Assert
    expect(getEntityDescriptor("registry-nope")).toBeUndefined();
  });
});

describe("requireEntityDescriptor", () => {
  it("returns the registered descriptor", () => {
    // Arrange
    const descriptor = buildDescriptor("registry-require-hit");
    registerEntityDescriptor(descriptor);

    // Act / Assert
    expect(requireEntityDescriptor("registry-require-hit")).toBe(descriptor);
  });

  it("throws Error('No entity descriptor registered for resource \"x\"') for an unregistered name", () => {
    // Act / Assert
    expect(() => requireEntityDescriptor("registry-require-miss")).toThrow(
      'No entity descriptor registered for resource "registry-require-miss"',
    );
  });
});

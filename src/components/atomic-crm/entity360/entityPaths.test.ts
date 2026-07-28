import { beforeEach, describe, expect, it } from "vitest";

import type { EntityDescriptor } from "./entityDescriptor";
import {
  buildEditPath,
  buildListPath,
  buildNewPath,
  buildRecordPath,
  buildTabPath,
} from "./entityPaths";
import { registerEntityDescriptor } from "./registry";

/**
 * Story AC 3. `beforeEach` registers a fresh fixture descriptor under the
 * same name every time (`{ replace: true }`), so tests stay order-
 * independent per `.claude/rules/testing.md#Test-isolation` regardless of
 * registration order across the whole suite.
 */

const FIXTURE_NAME = "entity-paths-fixture";
const UNREGISTERED_NAME = "entity-paths-nope";

const buildFixtureDescriptor = (): EntityDescriptor => ({
  name: FIXTURE_NAME,
  label: "Fixture",
  // A pre-migration shape (`/{r}/{id}/show`) is the interesting case for
  // buildRecordPath/buildTabPath/buildEditPath's divergence — see
  // entityPaths.ts's buildEditPath doc comment.
  buildRecordPath: (id) => `/${FIXTURE_NAME}/${id}/show`,
});

beforeEach(() => {
  registerEntityDescriptor(buildFixtureDescriptor(), { replace: true });
});

describe("buildListPath", () => {
  it("returns /{name} for a registered resource", () => {
    // Act / Assert
    expect(buildListPath(FIXTURE_NAME)).toBe(`/${FIXTURE_NAME}`);
  });
});

describe("buildNewPath", () => {
  it("returns /{name}/new for a registered resource", () => {
    // Act / Assert
    expect(buildNewPath(FIXTURE_NAME)).toBe(`/${FIXTURE_NAME}/new`);
  });
});

describe("buildRecordPath", () => {
  it("delegates to the descriptor's buildRecordPath", () => {
    // Act / Assert
    expect(buildRecordPath(FIXTURE_NAME, 42)).toBe(`/${FIXTURE_NAME}/42/show`);
  });
});

describe("buildEditPath", () => {
  it("returns the literal /{name}/{id}/edit — NOT composed from buildRecordPath's /show suffix", () => {
    // Act
    const path = buildEditPath(FIXTURE_NAME, 42);

    // Assert — a naive `${buildRecordPath()}/edit` composition would produce
    // `/entity-paths-fixture/42/show/edit` here; that is exactly the
    // regression this test pins.
    expect(path).toBe(`/${FIXTURE_NAME}/42/edit`);
    expect(path).not.toContain("/show/edit");
  });
});

describe("buildTabPath", () => {
  it("returns {recordPath}/{tab}, derived from the descriptor's buildRecordPath", () => {
    // Act / Assert
    expect(buildTabPath(FIXTURE_NAME, 42, "overview")).toBe(
      `/${FIXTURE_NAME}/42/show/overview`,
    );
  });
});

describe("unregistered resource", () => {
  it("every builder throws the same not-registered error", () => {
    // Act / Assert
    const expectedMessage = `No entity descriptor registered for resource "${UNREGISTERED_NAME}"`;
    expect(() => buildListPath(UNREGISTERED_NAME)).toThrow(expectedMessage);
    expect(() => buildNewPath(UNREGISTERED_NAME)).toThrow(expectedMessage);
    expect(() => buildRecordPath(UNREGISTERED_NAME, 1)).toThrow(
      expectedMessage,
    );
    expect(() => buildEditPath(UNREGISTERED_NAME, 1)).toThrow(expectedMessage);
    expect(() => buildTabPath(UNREGISTERED_NAME, 1, "overview")).toThrow(
      expectedMessage,
    );
  });
});

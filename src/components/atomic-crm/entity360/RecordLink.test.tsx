import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

import type { EntityDescriptor } from "./entityDescriptor";
import { registerEntityDescriptor } from "./registry";
import { RecordLink, type RecordLinkProps } from "./RecordLink";

/**
 * Pins AC 1 of the RecordLink primitive story: renders through the
 * registry, degrades (never throws) for an unregistered resource, and keeps
 * a closed prop list. Every fixture registers a unique `name` (never reused
 * across tests) so no test depends on registry state left by another
 * (`.claude/rules/testing.md#Test-isolation`) — the registry's `Map` is
 * real, module-scoped state shared across this whole file.
 */

const registerFixture = (name: string): EntityDescriptor => {
  const descriptor: EntityDescriptor = {
    name,
    buildRecordPath: (id) => `/${name}/${id}/show`,
    label: name,
  };
  registerEntityDescriptor(descriptor, { replace: true });
  return descriptor;
};

describe("RecordLink — registered resource (AC 1a)", () => {
  it("renders an anchor whose href is the descriptor's buildRecordPath", async () => {
    // Arrange
    registerFixture("record-link-singles-fixture");

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <RecordLink resource="record-link-singles-fixture" id={7}>
          Nechama
        </RecordLink>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByRole("link", { name: "Nechama" }))
      .toHaveAttribute("href", "/record-link-singles-fixture/7/show");
  });

  it("forwards className and style verbatim onto the anchor", async () => {
    // Arrange
    registerFixture("record-link-style-fixture");

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <RecordLink
          resource="record-link-style-fixture"
          id={1}
          className="ql-enter"
          style={{ animationDelay: "80ms" }}
        >
          Styled
        </RecordLink>
      </TestMemoryRouter>,
    );

    // Assert
    const link = screen.getByRole("link", { name: "Styled" });
    await expect.element(link).toHaveClass("ql-enter");
    await expect
      .element(link)
      .toHaveAttribute("style", "animation-delay: 80ms;");
  });
});

describe("RecordLink — unregistered resource degrades, never throws (AC 1b)", () => {
  it("renders an inert span, leaves siblings mounted, and logs console.error exactly once naming the resource", async () => {
    // Arrange
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <div>
          <RecordLink resource="record-link-nope-fixture" id={1}>
            x
          </RecordLink>
          <span>sibling</span>
        </div>
      </TestMemoryRouter>,
    );

    // Assert — no anchor rendered for the unregistered resource.
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
    // Assert — the sibling is unaffected; nothing blew up the subtree.
    await expect.element(screen.getByText("sibling")).toBeInTheDocument();
    // Assert — the children still render as plain text inside the span.
    await expect.element(screen.getByText("x")).toBeInTheDocument();
    // Assert — exactly one console.error, naming the unregistered resource.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toContain("record-link-nope-fixture");

    consoleError.mockRestore();
  });

  it("forwards className and style verbatim onto the degraded span", async () => {
    // Arrange
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <RecordLink
          resource="record-link-nope-styled-fixture"
          id={1}
          className="ql-enter"
          style={{ animationDelay: "40ms" }}
        >
          Ghost
        </RecordLink>
      </TestMemoryRouter>,
    );

    // Assert
    const ghost = screen.getByText("Ghost");
    await expect.element(ghost).toHaveClass("ql-enter");
    await expect
      .element(ghost)
      .toHaveAttribute("style", "animation-delay: 40ms;");

    consoleError.mockRestore();
  });
});

describe("RecordLinkProps — closed prop list, exactly five keys (AC 1c)", () => {
  it("type-checks: no key beyond resource/id/children/className/style, and onClick is rejected", () => {
    type ExpectedKeys = "resource" | "id" | "children" | "className" | "style";
    // `true` only if RecordLinkProps has NEITHER a missing expected key NOR
    // an extra one beyond ExpectedKeys — i.e. exactly these five keys.
    type IsExactlyClosedPropList = [
      Exclude<ExpectedKeys, keyof RecordLinkProps>,
      Exclude<keyof RecordLinkProps, ExpectedKeys>,
    ] extends [never, never]
      ? true
      : false;
    // Fails to compile the moment RecordLinkProps gains or loses a key: the
    // literal `true` is only assignable to `IsExactlyClosedPropList` while
    // that type itself resolves to `true`.
    const hasExactlyFiveKeys: IsExactlyClosedPropList = true;

    const rejected = (
      // @ts-expect-error — onClick is not part of RecordLinkProps; the signature is closed (contract §7 rule 0).
      <RecordLink resource="x" id={1} onClick={() => {}}>
        {"x"}
      </RecordLink>
    );

    // Assert — the element still exists at runtime; only the TYPE is rejected above.
    expect(hasExactlyFiveKeys).toBe(true);
    expect(rejected).toBeDefined();
  });
});

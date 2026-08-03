import { describe, expect, it } from "vitest";

import {
  buildShareUrl,
  isShareUrl,
  readShareToken,
  SHARE_PATH,
  type ShareUrl,
} from "./shareToken";

const url = (overrides: Partial<ShareUrl> = {}): ShareUrl => ({
  pathname: SHARE_PATH,
  search: "",
  hash: "",
  ...overrides,
});

describe("isShareUrl", () => {
  it("accepts exactly /share", () => {
    // Arrange / Act / Assert
    expect(isShareUrl(url())).toBe(true);
  });

  it("rejects a trailing slash — the F9 asset-resolution trap 9.4 already closed", () => {
    // Arrange / Act / Assert
    expect(isShareUrl(url({ pathname: "/share/" }))).toBe(false);
  });

  it("rejects any other path", () => {
    // Arrange / Act / Assert
    expect(isShareUrl(url({ pathname: "/" }))).toBe(false);
    expect(isShareUrl(url({ pathname: "/shareish" }))).toBe(false);
    expect(isShareUrl(url({ pathname: "/find" }))).toBe(false);
  });
});

describe("readShareToken", () => {
  it("reads the token from the fragment (the preferred, log-safe place)", () => {
    // Arrange / Act / Assert
    expect(readShareToken(url({ hash: "#abc123def456" }))).toBe("abc123def456");
  });

  it("never reads a ?t= query param — this token is a bearer secret", () => {
    // Arrange / Act / Assert
    expect(readShareToken(url({ search: "?t=querytoken" }))).toBeNull();
  });

  it("reads only the fragment, ignoring any query param", () => {
    // Arrange / Act / Assert
    expect(
      readShareToken(url({ hash: "#hashtoken", search: "?t=querytoken" })),
    ).toBe("hashtoken");
  });

  it("returns null when no token is present", () => {
    // Arrange / Act / Assert
    expect(readShareToken(url())).toBeNull();
    expect(readShareToken(url({ hash: "#" }))).toBeNull();
  });
});

describe("buildShareUrl", () => {
  it("builds a fragment-form share URL", () => {
    // Arrange / Act / Assert
    expect(buildShareUrl("https://myshadchan.space", "tok123")).toBe(
      "https://myshadchan.space/share#tok123",
    );
  });

  it("round-trips with readShareToken", () => {
    // Arrange
    const built = buildShareUrl("https://example.test", "roundtriptoken");
    const parsed = new URL(built);

    // Act
    const token = readShareToken({
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    });

    // Assert
    expect(token).toBe("roundtriptoken");
  });
});

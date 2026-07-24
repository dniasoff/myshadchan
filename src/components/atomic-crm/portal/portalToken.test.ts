import { describe, expect, it } from "vitest";

import {
  buildPortalUrl,
  isPortalUrl,
  readPortalToken,
  type PortalUrl,
} from "./portalToken";

const url = (overrides: Partial<PortalUrl> = {}): PortalUrl => ({
  pathname: "/portal",
  search: "",
  hash: "",
  ...overrides,
});

describe("isPortalUrl", () => {
  it("accepts exactly /portal (with or without a trailing slash)", () => {
    expect(isPortalUrl(url())).toBe(true);
    expect(isPortalUrl(url({ pathname: "/portal/" }))).toBe(true);
  });

  it("rejects any other path", () => {
    expect(isPortalUrl(url({ pathname: "/" }))).toBe(false);
    expect(isPortalUrl(url({ pathname: "/portalish" }))).toBe(false);
    expect(isPortalUrl(url({ pathname: "/shidduchim" }))).toBe(false);
  });
});

describe("readPortalToken", () => {
  it("reads the token from the fragment (the preferred, log-safe place)", () => {
    expect(readPortalToken(url({ hash: "#abc123def456" }))).toBe(
      "abc123def456",
    );
  });

  it("ignores a ?t= query param (never read from the query — logged in transit)", () => {
    expect(readPortalToken(url({ search: "?t=querytoken" }))).toBeNull();
  });

  it("reads only the fragment, ignoring any query param", () => {
    expect(
      readPortalToken(url({ hash: "#hashtoken", search: "?t=querytoken" })),
    ).toBe("hashtoken");
  });

  it("returns null when no token is present", () => {
    expect(readPortalToken(url())).toBeNull();
    expect(readPortalToken(url({ hash: "#" }))).toBeNull();
    expect(readPortalToken(url({ search: "?t=" }))).toBeNull();
  });
});

describe("buildPortalUrl", () => {
  it("builds a fragment-form portal URL", () => {
    expect(buildPortalUrl("https://myshadchan.space", "tok123")).toBe(
      "https://myshadchan.space/portal#tok123",
    );
  });

  it("round-trips with readPortalToken", () => {
    const built = buildPortalUrl("https://example.test", "roundtriptoken");
    const parsed = new URL(built);
    expect(
      readPortalToken({
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
      }),
    ).toBe("roundtriptoken");
  });
});

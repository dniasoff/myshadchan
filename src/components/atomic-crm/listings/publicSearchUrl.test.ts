import { describe, expect, it } from "vitest";

import {
  isPublicSearchUrl,
  PUBLIC_SEARCH_PATH,
  type PublicSearchUrl,
} from "./publicSearchUrl";

const url = (overrides: Partial<PublicSearchUrl> = {}): PublicSearchUrl => ({
  pathname: PUBLIC_SEARCH_PATH,
  search: "",
  ...overrides,
});

describe("isPublicSearchUrl", () => {
  it("accepts exactly /find", () => {
    expect(isPublicSearchUrl(url())).toBe(true);
  });

  it("rejects a trailing slash (F9: base:'./' + the SPA catch-all rewrite would break asset loading there)", () => {
    expect(isPublicSearchUrl(url({ pathname: "/find/" }))).toBe(false);
  });

  it("accepts /find whether or not a query string is present", () => {
    expect(isPublicSearchUrl(url({ search: "?q=chaya" }))).toBe(true);
    expect(isPublicSearchUrl(url({ search: "" }))).toBe(true);
  });

  it("rejects any other path", () => {
    expect(isPublicSearchUrl(url({ pathname: "/" }))).toBe(false);
    expect(isPublicSearchUrl(url({ pathname: "/findable" }))).toBe(false);
    // AD-24/coding-style naming guard: this must never collide with Story
    // 4.5's authenticated in-app "Global search" (Cmd/Ctrl+K).
    expect(isPublicSearchUrl(url({ pathname: "/search" }))).toBe(false);
    expect(isPublicSearchUrl(url({ pathname: "/shidduchim" }))).toBe(false);
  });
});

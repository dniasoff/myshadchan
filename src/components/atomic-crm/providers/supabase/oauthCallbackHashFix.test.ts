import { describe, expect, it } from "vitest";
import { fixDoubleHashOAuthCallback } from "./oauthCallbackHashFix";

describe("fixDoubleHashOAuthCallback", () => {
  it("returns null for a plain URL with no fragment at all", () => {
    // Arrange
    const href = "https://www.myshadchan.space/";

    // Act
    const result = fixDoubleHashOAuthCallback(href);

    // Assert
    expect(result).toBeNull();
  });

  it("returns null for a normal single-hash in-app route", () => {
    // Arrange
    const href = "https://www.myshadchan.space/#/login";

    // Act
    const result = fixDoubleHashOAuthCallback(href);

    // Assert
    expect(result).toBeNull();
  });

  it("returns null for GoTrue's error-redirect shape, which already parses correctly", () => {
    // Arrange: single `#`, `&`-glued error params — oauthCallback.ts's own
    // readOAuthCallbackError already handles this shape; this function must
    // not touch it.
    const href =
      "https://www.myshadchan.space/#/auth-callback&error=access_denied&error_description=User+cancelled";

    // Act
    const result = fixDoubleHashOAuthCallback(href);

    // Assert
    expect(result).toBeNull();
  });

  it("repairs the real double-hash shape captured from GoTrue's success redirect", () => {
    // Arrange — the exact shape observed in production: origin + our own
    // "/#/auth-callback" route, then GoTrue's own "#access_token=..." glued
    // directly onto it as a second, literal fragment delimiter.
    const href =
      "https://www.myshadchan.space/#/auth-callback#access_token=eyJhbGciOiJIUzI1NiJ9.abc&expires_in=3600&refresh_token=v1.Mabc&token_type=bearer";

    // Act
    const result = fixDoubleHashOAuthCallback(href);

    // Assert: the app's own "/auth-callback" route segment is discarded —
    // only GoTrue's token fragment survives, as the URL's ONE true fragment,
    // starting directly with a real key (never a route prefix glued in front
    // of it) so @supabase/auth-js's own parser can read `access_token` intact.
    expect(result).toBe(
      "https://www.myshadchan.space/#access_token=eyJhbGciOiJIUzI1NiJ9.abc&expires_in=3600&refresh_token=v1.Mabc&token_type=bearer",
    );
  });

  it("preserves everything before the first hash untouched, including query strings", () => {
    // Arrange
    const href =
      "https://www.myshadchan.space/some/path?foo=bar#/auth-callback#access_token=abc123";

    // Act
    const result = fixDoubleHashOAuthCallback(href);

    // Assert
    expect(result).toBe(
      "https://www.myshadchan.space/some/path?foo=bar#access_token=abc123",
    );
  });
});
